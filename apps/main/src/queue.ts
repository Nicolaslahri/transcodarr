import { getDb } from './db.js';
import { nanoid } from 'nanoid';
import { BUILT_IN_RECIPES, shouldSkipFile } from '@transcodarr/shared';
import { execFileSync } from 'child_process';
import { getFfprobePath } from './ffmpeg.js';
import path from 'path';
import type { Job, JobStatus, FileAnalysis } from '@transcodarr/shared';

// ─── ffprobe analysis ─────────────────────────────────────────────────────────

export function analyzeFile(filePath: string): FileAnalysis | null {
  try {
    const probeJson = execFileSync(
      getFfprobePath(),
      ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath],
      { encoding: 'utf8', timeout: 30_000 },
    );
    const probe = JSON.parse(probeJson);
    const videoStream  = probe.streams?.find((s: any) => s.codec_type === 'video');
    const audioStreams = probe.streams?.filter((s: any) => s.codec_type === 'audio') ?? [];

    if (!videoStream) return null;

    return {
      codec:          videoStream.codec_name ?? 'unknown',
      duration:       parseFloat(probe.format?.duration ?? '0'),
      bitrate:        parseInt(probe.format?.bit_rate ?? '0', 10),
      resolution:     `${videoStream.width}x${videoStream.height}`,
      audioCodec:     audioStreams[0]?.codec_name ?? 'unknown',
      audioLanguages: audioStreams.map((s: any) => s.tags?.language ?? 'und'),
      fileSize:       parseInt(probe.format?.size ?? '0', 10),
      container:      probe.format?.format_name ?? 'unknown',
    };
  } catch {
    return null;
  }
}

// ─── Queue CRUD ───────────────────────────────────────────────────────────────

/** Record a file as processed so it won't be re-queued even after "Clear All". */
export function recordProcessedFile(filePath: string, fileSize: number, recipeId: string): void {
  try {
    getDb().prepare(`
      INSERT OR REPLACE INTO processed_files (file_path, recipe, file_size, processed_at)
      VALUES (?, ?, ?, ?)
    `).run(filePath, recipeId, fileSize, Math.floor(Date.now() / 1000));
  } catch { /* non-critical */ }
}

export function enqueueFile(filePath: string, recipeId: string, force = false): Job | null {
  const db = getDb();
  const recipe = BUILT_IN_RECIPES.find(r => r.id === recipeId);
  if (!recipe) return null;

  // Prevent duplicates natively.
  // If not forced (auto-scanned by Watcher), reject if ANY record of the file exists.
  // If forced (manual click via UI), only reject if it's currently actively processing.
  if (!force) {
    // Check persistent fingerprint first (survives "Clear All")
    const processed = db.prepare('SELECT file_path FROM processed_files WHERE file_path = ? AND recipe = ?').get(filePath, recipeId);
    if (processed) return null;
    const existing = db.prepare('SELECT id FROM jobs WHERE file_path = ?').get(filePath);
    if (existing) return null;
  } else {
    const existing = db.prepare('SELECT id FROM jobs WHERE file_path = ? AND status NOT IN (?,?,?)').get(filePath, 'complete', 'skipped', 'failed');
    if (existing) return null;
  }

  // Analyze with ffprobe
  const analysis = analyzeFile(filePath);
  if (!analysis) return null;

  // Smart-filter: skip if already target codec
  if (shouldSkipFile(analysis.codec, recipe)) {
    db.prepare(`INSERT INTO jobs (id, file_path, file_name, file_size, codec_in, resolution, recipe, status) VALUES (?,?,?,?,?,?,?,?)`)
      .run(nanoid(), filePath, path.basename(filePath), analysis.fileSize, analysis.codec, analysis.resolution, recipeId, 'skipped');
    return null;
  }

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO jobs (id, file_path, file_name, file_size, codec_in, resolution, recipe, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(id, filePath, path.basename(filePath), analysis.fileSize, analysis.codec, analysis.resolution, recipeId, 'queued', now, now);

  return getJob(id);
}

export function getJob(id: string): Job | null {
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
  return row ? rowToJob(row) : null;
}

export function getJobs(limit = 100, offset = 0): Job[] {
  return (getDb().prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[]).map(rowToJob);
}

export function getJobsByStatus(status: JobStatus): Job[] {
  return (getDb().prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at ASC').all(status) as any[]).map(rowToJob);
}

export function updateJobStatus(id: string, status: JobStatus, extra: Record<string, unknown> = {}): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const fields = Object.entries({ status, updated_at: now, ...extra })
    .map(([k]) => `${k} = ?`).join(', ');
  const values = Object.values({ status, updated_at: now, ...extra });
  db.prepare(`UPDATE jobs SET ${fields} WHERE id = ?`).run(...values, id);
}

export function getStats() {
  const db = getDb();
  const today = Math.floor(Date.now() / 1000) - 86_400;
  const jobsToday = (db.prepare('SELECT COUNT(*) as c FROM jobs WHERE status = ? AND completed_at > ?').get('complete', today) as any).c;
  const jobsTotal = (db.prepare('SELECT COUNT(*) as c FROM jobs WHERE status = ?').get('complete') as any).c;
  const gbSaved = (db.prepare('SELECT SUM(size_before - size_after) as s FROM jobs WHERE status = ? AND size_before IS NOT NULL AND size_after IS NOT NULL').get('complete') as any).s ?? 0;
  const queueDepth = (db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status IN ('queued','pending')").get() as any).c;
  const activeJobs = (db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status IN ('transcoding','dispatched','swapping')").get() as any).c;
  return { jobsToday, jobsTotal, gbSaved: Math.round((gbSaved / 1e9) * 100) / 100, queueDepth, activeJobs };
}

export function deleteJob(id: string): boolean {
  const info = getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id);
  return Number(info.changes) > 0;
}

/** Clear jobs by status (default: all non-active). Returns count deleted. */
export function clearQueue(statuses: string[] = ['queued', 'skipped', 'failed', 'complete']): number {
  const placeholders = statuses.map(() => '?').join(',');
  const info = getDb().prepare(`DELETE FROM jobs WHERE status IN (${placeholders})`).run(...statuses);
  return Number(info.changes);
}

// ─── Row → Type ───────────────────────────────────────────────────────────────

function rowToJob(row: any): Job {
  return {
    id:          row.id,
    filePath:    row.file_path,
    fileName:    row.file_name,
    fileSize:    row.file_size,
    codecIn:     row.codec_in,
    resolution:  row.resolution,
    recipe:      row.recipe,
    status:      row.status,
    workerId:    row.worker_id,
    progress:    row.progress ?? 0,
    fps:         row.fps,
    eta:         row.eta,
    phase:       row.phase ?? undefined,
    error:       row.error,
    sizeBefore:  row.size_before,
    sizeAfter:   row.size_after,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
    completedAt: row.completed_at,
  };
}

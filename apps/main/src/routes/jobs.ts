import type { FastifyInstance } from 'fastify';
import { getJobs, getJob, enqueueFile, updateJobStatus, getStats, deleteJob, clearQueue, analyzeFile } from '../queue.js';
import { broadcast } from '../server.js';
import { dispatchNext } from '../dispatcher.js';
import { getDb } from '../db.js';
import fs from 'fs';
import path from 'path';

// ─── Smart retry helpers ──────────────────────────────────────────────────────

/** Recursively search a directory tree for a file matching the given basename. */
function searchDirForFile(dir: string, fileName: string): string | undefined {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) return full;
      if (entry.isDirectory()) {
        const found = searchDirForFile(full, fileName);
        if (found) return found;
      }
    }
  } catch { /* skip unreadable dirs */ }
  return undefined;
}

/** Search all enabled watched paths for the first file whose name matches. */
function findFileInWatchedPaths(fileName: string): string | undefined {
  const dirs = (getDb().prepare('SELECT path FROM watched_paths WHERE enabled = 1').all() as any[])
    .map((r: any) => r.path as string);
  for (const dir of dirs) {
    const found = searchDirForFile(dir, fileName);
    if (found) return found;
  }
  return undefined;
}

/**
 * Smart-retry a single failed job.
 *
 * Checkpoint logic:
 *  • "file not found" errors  → search watched paths by filename, re-probe,
 *    update file_path + analysis columns before re-queuing.
 *  • All other errors         → clean state reset (phase cleared, progress reset).
 *
 * The job is left in 'queued' status ready for the next dispatchNext() call.
 */
function smartRetryJob(jobId: string): void {
  const job = getJob(jobId);
  if (!job) return;

  const db  = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Detect file-not-found class of errors (ENOENT, ffprobe crash, worker "not found" msg, etc.)
  const isFileNotFound = /enoent|no such file|file not found|cannot open|ffprobe|not found/i.test(job.error ?? '');

  if (isFileNotFound) {
    let resolvedPath = job.filePath;

    // If the file is missing from its recorded path, hunt for it by name in watched folders
    if (!fs.existsSync(job.filePath)) {
      const located = findFileInWatchedPaths(job.fileName);
      if (located) {
        resolvedPath = located;
        console.log(`🔍 Retry: re-located "${job.fileName}" → ${resolvedPath}`);
      } else {
        console.log(`🔍 Retry: "${job.fileName}" still not found in any watched path — will retry at original path`);
      }
    }

    // Re-run ffprobe on the (potentially relocated) file to refresh all metadata
    const analysis = analyzeFile(resolvedPath);
    if (analysis) {
      const contentKey = `${Math.round(analysis.duration)}:${analysis.fileSize}`;
      db.prepare(`
        UPDATE jobs
        SET file_path = ?, file_size = ?, codec_in = ?, resolution = ?,
            has_subtitles = ?, content_key = ?, updated_at = ?
        WHERE id = ?
      `).run(
        resolvedPath, analysis.fileSize, analysis.codec, analysis.resolution,
        analysis.hasSubtitles ? 1 : 0, contentKey, now, jobId,
      );
      console.log(`🔍 Retry: re-analyzed "${job.fileName}" — ${analysis.codec} @ ${analysis.resolution}`);
    } else if (resolvedPath !== job.filePath) {
      // File located but analysis failed — at least update the path
      db.prepare('UPDATE jobs SET file_path = ?, updated_at = ? WHERE id = ?')
        .run(resolvedPath, now, jobId);
    }
  }

  // Common clean-state reset
  updateJobStatus(jobId, 'queued', {
    error:     null,
    progress:  0,
    worker_id: null,
    phase:     null,
    fps:       null,
    eta:       null,
  });
}

export async function jobsRoutes(app: FastifyInstance) {
  // GET /api/jobs
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/', async (req) => {
    const limit  = Math.min(parseInt(req.query.limit ?? '50'), 200);
    const offset = parseInt(req.query.offset ?? '0');
    return getJobs(limit, offset);
  });

  // GET /api/jobs/stats
  app.get('/stats', async () => getStats());

  // GET /api/jobs/:id
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    return job;
  });

  // POST /api/jobs — manually enqueue a file
  app.post<{ Body: { filePath: string; recipe: string } }>('/', async (req, reply) => {
    const job = enqueueFile(req.body.filePath, req.body.recipe, true);
    if (!job) return reply.status(400).send({ error: 'Could not enqueue file (already queued, skipped, or unreadable)' });
    dispatchNext().catch(() => {});
    return job;
  });

  // DELETE /api/jobs — clear history (completed + failed + skipped only, never touches queued)
  app.delete('/', async () => {
    const count = clearQueue(['complete', 'failed', 'skipped']);
    broadcast('job:cleared', { count });
    broadcast('stats:update', getStats());
    return { ok: true, deleted: count };
  });

  // DELETE /api/jobs/:id — permanently remove a single job
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    if (['transcoding', 'dispatched', 'swapping'].includes(job.status)) {
      return reply.status(400).send({ error: 'Cannot remove an in-progress job' });
    }
    deleteJob(req.params.id);
    broadcast('job:removed', { id: req.params.id });
    broadcast('stats:update', getStats());
    return { ok: true };
  });

  // POST /api/jobs/:id/cancel — cancel an active job and re-queue it
  app.post<{ Params: { id: string } }>('/:id/cancel', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    if (!['dispatched', 'transcoding', 'swapping'].includes(job.status)) {
      return reply.status(400).send({ error: 'Job is not active' });
    }

    // Tell the worker to kill its ffmpeg process
    if (job.workerId) {
      const workerRow = getDb().prepare('SELECT host, port FROM workers WHERE id = ?').get(job.workerId) as any;
      if (workerRow) {
        try {
          await fetch(`http://${workerRow.host}:${workerRow.port}/job`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(5_000),
          });
        } catch { /* worker unreachable — still re-queue */ }
      }
    }

    // Re-queue at same sort_order.
    // NOTE: do NOT mark worker idle here — the worker's cleanup callback (complete route)
    // is the single source of truth for releasing the worker. Marking idle + dispatching
    // here would race with the callback, potentially sending two jobs to the same worker.
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      'UPDATE jobs SET status = ?, worker_id = NULL, phase = NULL, progress = 0, callback_token = NULL, dispatched_at = NULL, fps = NULL, eta = NULL, error = NULL, updated_at = ? WHERE id = ?'
    ).run('queued', now, req.params.id);

    const updated = getJob(req.params.id);
    broadcast('job:queued', updated);
    broadcast('stats:update', getStats());
    return updated;
  });

  // POST /api/jobs/:id/retry — smart-retry a single failed job
  // • File-not-found errors: searches watched paths by filename and re-probes
  // • All errors:            resets phase/progress/error before re-queuing
  app.post<{ Params: { id: string } }>('/:id/retry', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    if (job.status !== 'failed') return reply.status(400).send({ error: 'Only failed jobs can be retried' });
    smartRetryJob(req.params.id);
    broadcast('job:queued', getJob(req.params.id));
    broadcast('stats:update', getStats());
    dispatchNext().catch(() => {});
    return getJob(req.params.id);
  });

  // POST /api/jobs/retry-all — smart-retry all failed jobs at once
  app.post('/retry-all', async () => {
    const failedIds = (getDb().prepare("SELECT id FROM jobs WHERE status = 'failed'").all() as any[]).map(r => r.id);
    for (const id of failedIds) {
      smartRetryJob(id);
    }
    dispatchNext().catch(() => {});
    broadcast('stats:update', getStats());
    return { ok: true, retried: failedIds.length };
  });

  // PATCH /api/jobs/reorder — drag-to-reorder; body: { orderedIds: string[] }
  app.patch<{ Body: { orderedIds: string[] } }>('/reorder', async (req) => {
    const { orderedIds } = req.body;
    const stmt = getDb().prepare('UPDATE jobs SET sort_order = ? WHERE id = ?');
    orderedIds.forEach((id, i) => stmt.run(i, id));
    broadcast('stats:update', getStats());
    return { ok: true };
  });

  // PATCH /api/jobs/:id — update pinnedWorkerId or other mutable fields
  app.patch<{ Params: { id: string }; Body: { pinnedWorkerId?: string | null } }>('/:id', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    const extra: Record<string, unknown> = {};
    if ('pinnedWorkerId' in req.body) extra.pinned_worker_id = req.body.pinnedWorkerId ?? null;
    if (Object.keys(extra).length) updateJobStatus(req.params.id, job.status, extra);
    return getJob(req.params.id);
  });

  // GET /api/jobs/stats/speed — aggregate speed statistics
  app.get('/stats/speed', async () => {
    const db = getDb();
    const avgFpsAll = (db.prepare("SELECT AVG(avg_fps) as a FROM jobs WHERE status = 'complete' AND avg_fps IS NOT NULL").get() as any)?.a ?? 0;
    const byRecipe = (db.prepare("SELECT recipe, AVG(avg_fps) as a FROM jobs WHERE status = 'complete' AND avg_fps IS NOT NULL GROUP BY recipe").all() as any[])
      .reduce((acc: Record<string, number>, r: any) => { acc[r.recipe] = Math.round(r.a); return acc; }, {});
    const byWorker = (db.prepare("SELECT worker_id, AVG(avg_fps) as a FROM jobs WHERE status = 'complete' AND avg_fps IS NOT NULL AND worker_id IS NOT NULL GROUP BY worker_id").all() as any[])
      .reduce((acc: Record<string, number>, r: any) => { acc[r.worker_id] = Math.round(r.a); return acc; }, {});
    const totalSeconds = (db.prepare("SELECT SUM(elapsed_seconds) as s FROM jobs WHERE status = 'complete' AND elapsed_seconds IS NOT NULL").get() as any)?.s ?? 0;
    const gbSaved = (db.prepare("SELECT SUM(size_before - size_after) as s FROM jobs WHERE status = 'complete' AND size_before IS NOT NULL AND size_after IS NOT NULL").get() as any)?.s ?? 0;
    return {
      avgFpsAllTime: Math.round(avgFpsAll),
      avgFpsByRecipe: byRecipe,
      avgFpsByWorker: byWorker,
      totalHoursTranscoded: Math.round((totalSeconds / 3600) * 10) / 10,
      totalGbSaved: Math.round((gbSaved / 1e9) * 100) / 100,
    };
  });
}

import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { JobPayload, HardwareProfile, ProgressUpdate } from '@transcodarr/shared';
import { buildFfmpegArgs, getHwDecodeArgs } from '@transcodarr/shared';
import { resolvedFfmpeg, resolvedFfprobe } from './hardware.js';

export interface TranscodeResult {
  sizeBefore: number;
  sizeAfter: number;
  outputPath: string;
}

/** Recursively search for a file by name under a base directory. Returns the first match or null. */
function findFileRecursively(dir: string, filename: string, depth = 0): string | null {
  if (depth > 12) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name === filename) return path.join(dir, entry.name);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = findFileRecursively(path.join(dir, entry.name), filename, depth + 1);
        if (found) return found;
      }
    }
  } catch { /* permission errors, skip */ }
  return null;
}

function getFileDuration(inputPath: string): number {
  try {
    // Use execFileSync (no shell) so filenames with quotes/special chars can't inject commands
    const out = execFileSync(
      resolvedFfprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputPath],
      { encoding: 'utf8', timeout: 30_000 },
    );
    return parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}

function parseProgressLine(line: string, duration: number): Partial<ProgressUpdate> | null {
  if (!line.includes('time=')) return null;

  // \d+ for hours (not \d{2}) so >99h jobs still parse correctly
  const timeMatch  = line.match(/time=(\d+):(\d{2}):(\d{2})\.(\d{2})/);
  const fpsMatch   = line.match(/fps=\s*([0-9.]+)/);
  // speed=1.96x → ffmpeg processes 1.96 seconds of video per real second
  const speedMatch = line.match(/speed=\s*([0-9.]+)x/);
  if (!timeMatch) return null;

  const elapsed = parseInt(timeMatch[1]) * 3600
    + parseInt(timeMatch[2]) * 60
    + parseInt(timeMatch[3])
    + parseInt(timeMatch[4]) / 100;

  const progress = duration > 0 ? Math.min(99, Math.round((elapsed / duration) * 100)) : 0;
  const fps      = fpsMatch ? parseFloat(fpsMatch[1]) : undefined;

  // Prefer speed= for ETA (most accurate). Fall back to fps / assumed 24fps source.
  const speed = speedMatch ? parseFloat(speedMatch[1]) : undefined;
  const eta = (() => {
    const remaining = duration - elapsed;
    if (duration <= 0 || remaining <= 0) return undefined;
    if (speed && speed > 0) return Date.now() + (remaining / speed) * 1000;
    if (fps && fps > 0)     return Date.now() + (remaining / (fps / 24)) * 1000; // fallback
    return undefined;
  })();

  return { progress, fps, eta, phase: 'transcoding' };
}

// ─── ffmpeg arg sanitisation ──────────────────────────────────────────────────
// Reject custom-recipe ffmpegArgs that try to read or write arbitrary files
// via ffmpeg's URL-protocol / filter surface. spawn() blocks shell injection,
// but ffmpeg itself can open `concat:`, `subfile:`, `pipe:`, `file:` etc.
// Patterns are case-insensitive substring matches against any single arg.
//
// Mirrors packages/shared/src/schemas.ts DANGEROUS_FFMPEG_PATTERNS.
// Defence in depth: schema validates at API boundary, this catches at exec.
const DANGEROUS_FFMPEG_PATTERNS: string[] = [
  // URL-protocol family
  'concat:', 'subfile:', 'pipe:', 'file:', 'fd:', 'tee:',
  'cache:', 'crypto:', 'async:', 'data:', 'md5:', 'unix:',
  'tcp://', 'udp://', 'rtmp://', 'rtsp://', 'srt://', 'sftp://',
  'ftp://', 'http://', 'https://', 'tls://', 'gopher://', 'gophers://',
  'mmsh://', 'mmst://', 'bluray:', 'prompeg:',
  // Filter family — `movie=` / `amovie=` open arbitrary files via lavfi
  'movie=', 'amovie=',
  'subfile=',
];

// Two-arg sequences. The substring scan above can't catch `['-f', 'lavfi']`
// because the literal `-f lavfi` never appears in a single argv entry.
const DANGEROUS_FFMPEG_PAIRS: Array<[string, string]> = [
  ['-f', 'lavfi'],
  ['-f', 'concat'],
  ['-f', 'image2'],
  ['-f', 'tee'],
];

// Single-arg flags that are dangerous regardless of position or whether a
// value follows. Lifted out of the pair check so the trailing-arg case is
// also caught (a bare `-init_hw_device` at the end of args used to slip through).
const DANGEROUS_FFMPEG_FLAGS = new Set([
  '-init_hw_device',
  '-attach',
  '-dump_attachment',
]);

export function sanitizeFfmpegArgs(args: string[]): { ok: true } | { ok: false; reason: string } {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== 'string') return { ok: false, reason: 'non-string ffmpeg arg' };
    const lower = arg.toLowerCase();
    for (const pat of DANGEROUS_FFMPEG_PATTERNS) {
      if (lower.includes(pat)) return { ok: false, reason: `dangerous pattern "${pat}" in arg "${arg}"` };
    }
    // Reject standalone -i flags inside recipe args — input is set by the worker
    if (arg === '-i') return { ok: false, reason: 'recipe args may not contain -i (input is set by worker)' };
    // Reject explicit output redirect — output path is set by worker
    if (arg === '-y' || arg === '-Y') return { ok: false, reason: 'recipe args may not contain -y / -Y' };
    // Single-flag check: catches dangerous flags whether or not they're followed by a value.
    if (DANGEROUS_FFMPEG_FLAGS.has(lower)) return { ok: false, reason: `dangerous flag "${arg}"` };
    // Pairwise check: catches argv-split forms like `['-f', 'lavfi']`
    if (i + 1 < args.length) {
      const next = (args[i + 1] ?? '').toLowerCase();
      for (const [a, b] of DANGEROUS_FFMPEG_PAIRS) {
        if (lower === a && next === b) return { ok: false, reason: `dangerous pair "${a} ${b}"` };
      }
    }
  }
  return { ok: true };
}

export async function transcodeFile(
  payload: JobPayload,
  hardware: HardwareProfile,
  onProgress: (update: Partial<ProgressUpdate>) => void,
  signal?: AbortSignal,
): Promise<TranscodeResult> {
  let inputPath = payload.smbPath ?? payload.filePath;
  const ext       = payload.recipe.targetContainer === 'mp4' ? '.mp4' : '.mkv';

  // If the translated SMB path doesn't exist, try to find the file by name under the base path
  if (!fs.existsSync(inputPath) && payload.smbPath && payload.smbBasePath) {
    const filename = path.basename(payload.smbPath);
    console.log(`⚠️  SMB path not found: ${inputPath} — searching under ${payload.smbBasePath} for "${filename}"`);
    const found = findFileRecursively(payload.smbBasePath, filename);
    if (found) {
      console.log(`✅ Found via recursive search: ${found}`);
      inputPath = found;
    }
  }

  const dir       = path.dirname(inputPath);
  const base      = path.basename(inputPath, path.extname(inputPath));
  const tmpPath   = path.join(dir, `${base}.transcodarr_tmp${ext}`);
  const finalPath = path.join(dir, `${base}${ext}`);

  if (!fs.existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);
  const sizeBefore = fs.statSync(inputPath).size;

  // Disk space pre-flight — refuse to start if free space < sizeBefore × 1.2
  // (encode produces a copy alongside the source). Avoids hours of GPU time
  // wasted only to fail at 99% with ENOSPC.
  try {
    const stat = (fs as any).statfsSync(dir);
    const freeBytes = stat.bavail * stat.bsize;
    const requiredBytes = Math.floor(sizeBefore * 1.2);
    if (freeBytes < requiredBytes) {
      throw new Error(
        `Insufficient disk space at ${dir}: ${(freeBytes / 1e9).toFixed(1)} GB free, ` +
        `need ${(requiredBytes / 1e9).toFixed(1)} GB (1.2× source size)`,
      );
    }
  } catch (e: any) {
    // statfsSync may throw on platforms/paths that don't support it — only re-throw
    // our own preflight error, swallow the platform error so the encode still runs.
    if (e?.message?.startsWith('Insufficient disk space')) throw e;
  }

  // Clean up any stale temp file
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

  const duration    = getFileDuration(inputPath);
  // Pass recipeId and custom ffmpegArgs so CUDA incompatible recipes fall back to GPU-decode-only
  const hwDecArgs   = getHwDecodeArgs(hardware, payload.recipe.id, payload.recipe.ffmpegArgs);
  const recipeArgs  = buildFfmpegArgs(payload.recipe, hardware, payload.langPrefs);

  // Validate any custom recipe args before they reach spawn() — these come from
  // the user-editable custom_recipes settings row and could otherwise let an
  // operator with web-UI access read arbitrary files via ffmpeg protocols.
  if (payload.recipe.ffmpegArgs && payload.recipe.ffmpegArgs.length > 0) {
    const check = sanitizeFfmpegArgs(payload.recipe.ffmpegArgs);
    if (!check.ok) throw new Error(`Recipe rejected: ${check.reason}`);
  }

  const ffmpegArgs = [
    '-hide_banner', '-loglevel', 'error', '-stats',
    ...hwDecArgs,
    '-i', inputPath,
    ...recipeArgs,
    '-map_metadata', '0',
    '-map_chapters', '0',
    '-y', tmpPath,
  ];

  console.log(`🎬 ffmpeg ${ffmpegArgs.join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(resolvedFfmpeg, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let leftover = '';
    let errorLog = '';
    let cancelled = false;

    let killTimer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      cancelled = true;
      proc.kill('SIGTERM');
      // Escalate to SIGKILL if SIGTERM is ignored. Keep the handle so we can
      // clear it on normal exit — otherwise the timer fires after the process
      // is gone and may target a recycled PID on Linux.
      killTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      }, 5000);
    };
    if (signal) {
      if (signal.aborted) { proc.kill('SIGTERM'); }
      else signal.addEventListener('abort', onAbort);
    }

    const handleData = (data: Buffer) => {
      // Cap each incoming chunk first so a single massive ffmpeg error burst
      // can't spike memory before the rolling-window check fires
      const chunk = data.toString().slice(-5000);
      errorLog = (errorLog + chunk).slice(-5000);

      leftover += chunk;
      const parts = leftover.split(/[\r\n]+/);
      leftover = parts.pop() ?? '';
      for (const line of parts) {
        const update = parseProgressLine(line, duration);
        if (update) onProgress(update);
      }
    };

    // Centralised cleanup so both `close` and `error` paths reliably clear
    // the abort-event listener AND the SIGKILL timer. Previously `error` only
    // called `reject`, which leaked the listener and let the 5 s SIGKILL
    // timer fire against a recycled PID on Linux.
    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (killTimer) { clearTimeout(killTimer); killTimer = null; }
    };

    proc.stderr.on('data', handleData);
    proc.stdout.on('data', handleData);
    proc.on('close', code => {
      cleanup();
      if (cancelled) {
        // Clean up the partial tmp file immediately so it doesn't linger on disk
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* best effort */ }
        reject(new Error('Cancelled'));
      } else if (code === 0) {
        resolve();
      } else {
        const lines = errorLog.split('\n').filter(l => l.trim().length > 0);
        const lastLines = lines.slice(-5).join('; ');
        reject(new Error(`ffmpeg exited ${code}: ${lastLines}`));
      }
    });
    proc.on('error', err => {
      cleanup();
      // Also drop the partial tmp file if it managed to be created
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      reject(err);
    });
  });

  // ─── Atomic swap ──────────────────────────────────────────────────────────
  onProgress({ progress: 99, phase: 'swapping' });

  const bakPath = inputPath + '.bak';
  const extDiffers = inputPath !== finalPath;

  fs.renameSync(inputPath, bakPath);   // 1. rename original → .bak
  try {
    fs.renameSync(tmpPath, finalPath); // 2. rename tmp → final

    // 3. Verify finalPath actually exists and is non-empty before destroying the backup
    const finalStat = fs.statSync(finalPath);
    if (finalStat.size === 0) throw new Error('Output file is empty after rename');

    // 4. Delete .bak only after verifying the new file is in place. When the
    //    extension changed (e.g. .avi → .mkv) the .bak still has the original
    //    extension — verifying first avoids losing the only copy if the encode
    //    silently produced a zero-byte file.
    fs.unlinkSync(bakPath);

    if (extDiffers) {
      console.log(`[Worker] Container changed: ${path.extname(inputPath)} → ${path.extname(finalPath)} (original .bak removed after verification)`);
    }
  } catch (swapErr) {
    // Rollback: restore original from .bak so we don't lose the source file
    try {
      if (fs.existsSync(bakPath)) {
        fs.renameSync(bakPath, inputPath);
        console.error('[Worker] Swap failed — restored backup from .bak');
      }
    } catch (restoreErr) {
      console.error('[Worker] CRITICAL: swap failed AND restore failed — manual recovery needed:', restoreErr);
    }
    // If the new file made it to disk but verification failed, delete it so we don't
    // leave a half-baked output alongside the restored source.
    try { if (extDiffers && fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch { /* ignore */ }
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw swapErr;
  }

  const sizeAfter = fs.statSync(finalPath).size;
  return { sizeBefore, sizeAfter, outputPath: finalPath };
}

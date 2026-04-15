import { spawn, execSync } from 'child_process';
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
    const out = execSync(
      `"${resolvedFfprobe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`,
      { encoding: 'utf8', timeout: 30_000 },
    );
    return parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}

function parseProgressLine(line: string, duration: number): Partial<ProgressUpdate> | null {
  if (!line.includes('time=')) return null;

  const timeMatch  = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
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

  // Clean up any stale temp file
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

  const duration    = getFileDuration(inputPath);
  const hwDecArgs   = getHwDecodeArgs(hardware, payload.recipe.id);
  const recipeArgs  = buildFfmpegArgs(payload.recipe, hardware, payload.langPrefs);

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

    // ── Stall detector ─────────────────────────────────────────────────────────
    // When ffmpeg finishes encoding the last frame it does a silent post-processing
    // step (e.g. +faststart rewrites the entire MP4 to move the index atom to the
    // front). On a NAS/SMB share this can take 1-3 min with zero output, so to the
    // UI it looks frozen at 99%. We detect the silence and emit a 'finalizing' phase
    // so the user sees a clear message instead of a stuck progress bar.
    let lastProgressTime = Date.now();
    let latestProgress   = 0;
    let finalizingFired  = false;
    const finalizingInterval = setInterval(() => {
      if (!finalizingFired && latestProgress >= 99 && Date.now() - lastProgressTime > 8_000) {
        finalizingFired = true;
        onProgress({ progress: 99, phase: 'finalizing' });
      }
    }, 2_000);
    // ──────────────────────────────────────────────────────────────────────────

    const onAbort = () => {
      cancelled = true;
      proc.kill('SIGTERM');
      // Escalate to SIGKILL if SIGTERM is ignored
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      }, 5000);
    };
    if (signal) {
      if (signal.aborted) { proc.kill('SIGTERM'); }
      else signal.addEventListener('abort', onAbort);
    }

    const handleData = (data: Buffer) => {
      const chunk = data.toString();
      errorLog += chunk;
      if (errorLog.length > 5000) errorLog = errorLog.slice(-5000);

      leftover += chunk;
      const parts = leftover.split(/[\r\n]+/);
      leftover = parts.pop() ?? '';
      for (const line of parts) {
        const update = parseProgressLine(line, duration);
        if (update) {
          lastProgressTime = Date.now();
          latestProgress   = update.progress ?? 0;
          finalizingFired  = false; // reset if fresh progress arrives
          onProgress(update);
        }
      }
    };

    proc.stderr.on('data', handleData);
    proc.stdout.on('data', handleData);
    proc.on('close', code => {
      clearInterval(finalizingInterval);
      if (signal) signal.removeEventListener('abort', onAbort);
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
    proc.on('error', (err) => { clearInterval(finalizingInterval); reject(err); });
  });

  // ─── Atomic swap ──────────────────────────────────────────────────────────
  // Signal the 'swapping' phase BEFORE touching the filesystem, then yield
  // to the event loop so the async sendProgress fetch can actually execute.
  // Without the yield, the synchronous rename below blocks the event loop and
  // the 'swapping' notification never reaches Main until the rename finishes.
  onProgress({ progress: 99, phase: 'swapping' });
  await new Promise<void>(r => setImmediate(r)); // flush pending I/O / microtasks

  const bakPath = inputPath + '.bak';
  // Use async renames so the event loop stays responsive during slow NAS/SMB ops.
  await fs.promises.rename(inputPath, bakPath);   // 1. rename original → .bak
  try {
    await fs.promises.rename(tmpPath, finalPath); // 2. rename tmp → final
    await fs.promises.unlink(bakPath);            // 3. delete .bak
  } catch (swapErr) {
    // Rollback: restore original from .bak so we don't lose the source file
    try {
      if (fs.existsSync(bakPath)) {
        await fs.promises.rename(bakPath, inputPath);
        console.error('[Worker] Swap failed — restored backup from .bak');
      }
    } catch (restoreErr) {
      console.error('[Worker] CRITICAL: swap failed AND restore failed — manual recovery needed:', restoreErr);
    }
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw swapErr;
  }

  const sizeAfter = fs.statSync(finalPath).size;
  return { sizeBefore, sizeAfter, outputPath: finalPath };
}

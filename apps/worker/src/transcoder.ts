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

  const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  const fpsMatch  = line.match(/fps=\s*([0-9.]+)/);
  if (!timeMatch) return null;

  const elapsed = parseInt(timeMatch[1]) * 3600
    + parseInt(timeMatch[2]) * 60
    + parseInt(timeMatch[3])
    + parseInt(timeMatch[4]) / 100;

  const progress = duration > 0 ? Math.min(99, Math.round((elapsed / duration) * 100)) : 0;
  const fps      = fpsMatch ? parseFloat(fpsMatch[1]) : undefined;
  const eta      = (duration > 0 && fps && fps > 0)
    ? Date.now() + ((duration - elapsed) / fps) * 1000
    : undefined;

  return { progress, fps, eta, phase: 'transcoding' };
}

export async function transcodeFile(
  payload: JobPayload,
  hardware: HardwareProfile,
  onProgress: (update: Partial<ProgressUpdate>) => void,
): Promise<TranscodeResult> {
  const inputPath = payload.smbPath ?? payload.filePath;
  const ext       = payload.recipe.targetContainer === 'mp4' ? '.mp4' : '.mkv';
  const dir       = path.dirname(inputPath);
  const base      = path.basename(inputPath, path.extname(inputPath));
  const tmpPath   = path.join(dir, `${base}.transcodarr_tmp${ext}`);
  const finalPath = path.join(dir, `${base}${ext}`);

  if (!fs.existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);
  const sizeBefore = fs.statSync(inputPath).size;

  // Clean up any stale temp file
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

  const duration    = getFileDuration(inputPath);
  const hwDecArgs   = getHwDecodeArgs(hardware);
  const recipeArgs  = buildFfmpegArgs(payload.recipe, hardware);

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

    const handleData = (data: Buffer) => {
      const chunk = data.toString();
      errorLog += chunk;
      if (errorLog.length > 5000) errorLog = errorLog.slice(-5000);

      leftover += chunk;
      const parts = leftover.split(/[\r\n]+/);
      leftover = parts.pop() ?? '';
      for (const line of parts) {
        const update = parseProgressLine(line, duration);
        if (update) onProgress(update);
      }
    };

    proc.stderr.on('data', handleData);
    proc.stdout.on('data', handleData);
    proc.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        const lines = errorLog.split('\n').filter(l => l.trim().length > 0);
        const lastLines = lines.slice(-5).join('; ');
        reject(new Error(`ffmpeg exited ${code}: ${lastLines}`));
      }
    });
    proc.on('error', reject);
  });

  // ─── Atomic swap ──────────────────────────────────────────────────────────
  onProgress({ progress: 99, phase: 'swapping' });

  const bakPath = inputPath + '.bak';
  fs.renameSync(inputPath, bakPath);   // 1. rename original → .bak
  fs.renameSync(tmpPath, finalPath);   // 2. rename tmp → final
  fs.unlinkSync(bakPath);              // 3. delete .bak

  const sizeAfter = fs.statSync(finalPath).size;
  return { sizeBefore, sizeAfter, outputPath: finalPath };
}

import { execSync, execFileSync } from 'child_process';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { createRequire } from 'module';
import type { HardwareProfile, GpuVendor } from '@transcodarr/shared';

// ─── ffmpeg binary resolution ─────────────────────────────────────────────────

const BIN_DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/[A-Za-z]:/, (m) => m.slice(1))), '../../bin');
const LOCAL_FFMPEG = path.join(BIN_DIR, os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const LOCAL_FFPROBE = path.join(BIN_DIR, os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe');

export let resolvedFfmpeg = 'ffmpeg';
export let resolvedFfprobe = 'ffprobe';

/**
 * Resolves ffmpeg. Priority:
 *   0. FFMPEG_PATH / FFPROBE_PATH env vars (Docker / CI override)
 *   1. System PATH
 *   2. ./bin/ffmpeg[.exe] (previously auto-downloaded)
 *   3. Silent auto-download
 */
export async function ensureFfmpeg(): Promise<void> {
  // 0. Explicit env override (Docker, CI, etc.)
  if (process.env.FFMPEG_PATH) {
    resolvedFfmpeg = process.env.FFMPEG_PATH;
    resolvedFfprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
    console.log(`  ffmpeg: using FFMPEG_PATH env → ${resolvedFfmpeg}`);
    return;
  }

  // 1. Try system PATH
  if (isExecutable('ffmpeg')) {
    console.log('  ffmpeg: found in system PATH');
    return;
  }

  // 2. Try local ./bin/
  if (existsSync(LOCAL_FFMPEG)) {
    console.log('  ffmpeg: using local bin/ffmpeg');
    resolvedFfmpeg = LOCAL_FFMPEG;
    resolvedFfprobe = LOCAL_FFPROBE;
    return;
  }

  // 3. Auto-download (Windows/Linux static build)
  if (os.platform() === 'win32') {
    await downloadFfmpegWindows();
  } else {
    await downloadFfmpegLinux();
  }
  resolvedFfmpeg = LOCAL_FFMPEG;
  resolvedFfprobe = LOCAL_FFPROBE;
}

function isExecutable(cmd: string): boolean {
  try {
    // Use execFileSync (no shell) — avoids injection if cmd ever becomes user-configurable
    execFileSync(cmd, ['-version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function downloadFfmpegWindows(): Promise<void> {
  console.log('\n  ⬇️  ffmpeg not found — silently downloading static build (~75MB)...');
  mkdirSync(BIN_DIR, { recursive: true });

  // Download official BtbN GPL static build
  const url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');

  await downloadFile(url, zipPath);
  console.log('  📦 Extracting...');

  // Use PowerShell with -EncodedCommand (base64) so paths with apostrophes,
  // ampersands, semicolons, etc. cannot break out of the script context.
  const psEncode = (script: string): string =>
    Buffer.from(script, 'utf16le').toString('base64');

  const extractScript =
    `Expand-Archive -Force -Path ${psEscape(zipPath)} -DestinationPath ${psEscape(BIN_DIR)}`;
  execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${psEncode(extractScript)}`, { timeout: 60_000 });

  // Move ffmpeg.exe / ffprobe.exe up from the nested folder
  const ffmpegDest  = path.join(BIN_DIR, 'ffmpeg.exe');
  const ffprobeDest = path.join(BIN_DIR, 'ffprobe.exe');
  execSync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${psEncode(
      `Get-ChildItem -Path ${psEscape(BIN_DIR)} -Recurse -Filter 'ffmpeg.exe' | Copy-Item -Destination ${psEscape(ffmpegDest)} -Force`,
    )}`,
    { timeout: 10_000 },
  );
  execSync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${psEncode(
      `Get-ChildItem -Path ${psEscape(BIN_DIR)} -Recurse -Filter 'ffprobe.exe' | Copy-Item -Destination ${psEscape(ffprobeDest)} -Force`,
    )}`,
    { timeout: 10_000 },
  );

  console.log('  ✅ ffmpeg installed to ./bin/\n');
}

// Escape a string as a PowerShell single-quoted literal (doubles internal quotes).
// Used together with -EncodedCommand to neutralise apostrophes, ampersands, etc.
function psEscape(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

async function downloadFfmpegLinux(): Promise<void> {
  console.log('\n  ⬇️  ffmpeg not found — silently downloading static build...');
  mkdirSync(BIN_DIR, { recursive: true });

  const url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz';
  const tarPath = path.join(BIN_DIR, 'ffmpeg.tar.xz');

  await downloadFile(url, tarPath);
  execSync(`tar -xf "${tarPath}" -C "${BIN_DIR}" --strip-components=2 --wildcards "*/bin/ffmpeg" "*/bin/ffprobe"`, { timeout: 60_000 });
  execSync(`chmod +x "${LOCAL_FFMPEG}" "${LOCAL_FFPROBE}"`);

  console.log('  ✅ ffmpeg installed to ./bin/\n');
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const request = (urlStr: string) => {
      https.get(urlStr, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          request(res.headers.location!);
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    };
    request(url);
  });
}

// ─── Hardware detection ───────────────────────────────────────────────────────

function runFfmpeg(...args: string[]): string {
  try {
    return execFileSync(resolvedFfmpeg, args, { encoding: 'utf8', timeout: 15_000, stderr: 'pipe' } as any);
  } catch (e: any) {
    return (e.stdout as string) ?? (e.stderr as string) ?? '';
  }
}

export function detectHardware(): HardwareProfile {
  console.log('🔍 Detecting hardware capabilities...');

  // 1. hwaccels
  const hwOutput = runFfmpeg('-hide_banner', '-hwaccels');
  const hwaccels = hwOutput
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.toLowerCase().startsWith('hardware') && !l.toLowerCase().startsWith('video'));

  // 2. Encoders
  const encOutput = runFfmpeg('-hide_banner', '-encoders');
  const gpuEncoders: string[] = [];
  // Track which software (libx*) encoders are compiled into this ffmpeg build —
  // some minimal/distro builds ship without libx265 or libsvtav1 and would fail
  // with "Unknown encoder" otherwise. Surface this so the dispatcher can match
  // recipes to capable workers.
  const softwareEncoders: string[] = [];
  for (const line of encOutput.split('\n')) {
    const match = line.match(/^\s*V[\w.]+\s+([\w\-.]+)\s+/);
    if (!match) continue;
    const name = match[1];
    if (name.includes('nvenc') || name.includes('amf') || name.includes('qsv') || name.includes('vaapi')) {
      gpuEncoders.push(name);
    } else if (name === 'libx264' || name === 'libx265' || name === 'libsvtav1' || name === 'libaom-av1' || name === 'libvpx-vp9') {
      softwareEncoders.push(name);
    }
  }

  // 3. Decoders
  const decOutput = runFfmpeg('-hide_banner', '-decoders');
  const gpuDecoders: string[] = [];
  for (const line of decOutput.split('\n')) {
    const match = line.match(/^\s*V[\w.]+\s+(\w+)\s+/);
    if (!match) continue;
    const name = match[1];
    if (name.includes('cuvid') || name.includes('nvdec') || name.includes('qsv') || name.includes('amf')) {
      gpuDecoders.push(name);
    }
  }

  // 4. GPU vendor + name
  let gpu: GpuVendor = 'cpu';
  let gpuName = 'Software (CPU)';

  if (gpuEncoders.some(e => e.includes('nvenc'))) {
    gpu = 'nvidia';
    try {
      const smiOut = execFileSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { encoding: 'utf8', timeout: 5000 });
      const candidate = smiOut.trim().split('\n')[0]?.trim() ?? '';
      // Reject obvious driver-error strings — nvidia-smi can return non-zero output
      // like "Failed to initialize NVML: Driver/library version mismatch" with exit 0
      // when the kernel module is broken. That is NOT a GPU model.
      const looksLikeError = /^(Failed|Error|NVIDIA-SMI has failed|Unable)/i.test(candidate);
      gpuName = (candidate && !looksLikeError) ? candidate : 'NVIDIA GPU';
    } catch {
      gpuName = 'NVIDIA GPU';
    }
  } else if (gpuEncoders.some(e => e.includes('amf'))) {
    gpu = 'amd';
    gpuName = 'AMD GPU';
  } else if (gpuEncoders.some(e => e.includes('qsv') || e.includes('vaapi'))) {
    gpu = 'intel';
    gpuName = 'Intel GPU (QuickSync)';
  }

  // Filter encoders/decoders to only those matching the detected vendor.
  // ffmpeg lists ALL hardware codecs it was compiled with, regardless of whether
  // the hardware is actually present. Without filtering, an NVIDIA machine would
  // report amf and qsv encoders too, causing misleading badges in the UI.
  const vendorEncoderFilter = (e: string): boolean => {
    if (gpu === 'nvidia') return e.includes('nvenc');
    if (gpu === 'amd')    return e.includes('amf');
    if (gpu === 'intel')  return e.includes('qsv') || e.includes('vaapi');
    return false; // cpu — no hardware encoders
  };
  const vendorDecoderFilter = (e: string): boolean => {
    if (gpu === 'nvidia') return e.includes('cuvid') || e.includes('nvdec');
    if (gpu === 'amd')    return e.includes('amf');
    if (gpu === 'intel')  return e.includes('qsv');
    return false;
  };
  const filteredEncoders = gpuEncoders.filter(vendorEncoderFilter);
  const filteredDecoders = gpuDecoders.filter(vendorDecoderFilter);
  // Merge GPU-vendor encoders + the software encoders this ffmpeg build supports.
  // Recipes can then check `encoders.includes('libsvtav1')` before falling back
  // and the dispatcher can refuse to assign a recipe whose required software
  // encoder is missing on the worker's ffmpeg build.
  const allEncoders = [...filteredEncoders, ...softwareEncoders];

  const profile: HardwareProfile = { gpu, gpuName, encoders: allEncoders, decoders: filteredDecoders, hwaccels };

  console.log(`  GPU: ${gpuName} (${gpu.toUpperCase()})`);
  console.log(`  GPU encoders: ${filteredEncoders.join(', ') || 'none'}`);
  console.log(`  Software encoders: ${softwareEncoders.join(', ') || 'none'}`);

  return profile;
}

import { execSync } from 'child_process';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';

// ─── Binary resolution ─────────────────────────────────────────────────────────

const BIN_DIR      = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/[A-Za-z]:/, (m) => m.slice(1))), '../../bin');
const LOCAL_FFMPEG  = path.join(BIN_DIR, os.platform() === 'win32' ? 'ffmpeg.exe'  : 'ffmpeg');
const LOCAL_FFPROBE = path.join(BIN_DIR, os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe');

let resolvedFfprobe = 'ffprobe';

export function getFfprobePath(): string {
  return resolvedFfprobe;
}

/**
 * Resolves ffprobe for the Main node. Priority:
 *   0. FFPROBE_PATH env var (Docker / CI override)
 *   1. System PATH
 *   2. ./bin/ffprobe[.exe] (previously auto-downloaded)
 *   3. Silent auto-download
 */
export async function ensureFfmpeg(): Promise<void> {
  // 0. Explicit env override
  if (process.env.FFPROBE_PATH) {
    resolvedFfprobe = process.env.FFPROBE_PATH;
    console.log(`  ffprobe: using FFPROBE_PATH env → ${resolvedFfprobe}`);
    return;
  }

  // 1. Try system PATH
  if (isExecutable('ffprobe')) {
    console.log('  ffprobe: found in system PATH ✅');
    return;
  }

  // 2. Try local ./bin/
  if (existsSync(LOCAL_FFPROBE)) {
    console.log('  ffprobe: using local bin/ ✅');
    resolvedFfprobe = LOCAL_FFPROBE;
    return;
  }

  // 3. Auto-download static build
  if (os.platform() === 'win32') {
    await downloadFfmpegWindows();
  } else {
    await downloadFfmpegLinux();
  }
  resolvedFfprobe = LOCAL_FFPROBE;
}

function isExecutable(cmd: string): boolean {
  try {
    execSync(`${cmd} -version`, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function downloadFfmpegWindows(): Promise<void> {
  console.log('\n  ⬇️  ffprobe not found — silently downloading ffmpeg static build (~75MB)...');
  mkdirSync(BIN_DIR, { recursive: true });

  const url     = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');

  await downloadFile(url, zipPath);
  console.log('  📦 Extracting...');

  execSync(`powershell -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${BIN_DIR}'"`, { timeout: 60_000 });
  execSync(`powershell -Command "Get-ChildItem -Path '${BIN_DIR}' -Recurse -Filter 'ffmpeg.exe'  | Copy-Item -Destination '${path.join(BIN_DIR, 'ffmpeg.exe')}'  -Force"`, { timeout: 10_000 });
  execSync(`powershell -Command "Get-ChildItem -Path '${BIN_DIR}' -Recurse -Filter 'ffprobe.exe' | Copy-Item -Destination '${path.join(BIN_DIR, 'ffprobe.exe')}' -Force"`, { timeout: 10_000 });

  console.log('  ✅ ffprobe ready\n');
}

async function downloadFfmpegLinux(): Promise<void> {
  console.log('\n  ⬇️  ffprobe not found — silently downloading static build...');
  mkdirSync(BIN_DIR, { recursive: true });

  // In Docker (linux/arm64 or linux/amd64), ffmpeg is installed via apt in the Dockerfile
  // This fallback is for bare-metal Linux installs
  const arch  = os.arch() === 'arm64' ? 'linuxarm64' : 'linux64';
  const url   = `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${arch}-gpl.tar.xz`;
  const tarPath = path.join(BIN_DIR, 'ffmpeg.tar.xz');

  await downloadFile(url, tarPath);
  execSync(`tar -xf "${tarPath}" -C "${BIN_DIR}" --strip-components=2 --wildcards "*/bin/ffmpeg" "*/bin/ffprobe"`, { timeout: 60_000 });
  execSync(`chmod +x "${LOCAL_FFMPEG}" "${LOCAL_FFPROBE}"`);

  console.log('  ✅ ffprobe ready\n');
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file    = createWriteStream(dest);
    const request = (urlStr: string) => {
      https.get(urlStr, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) { request(res.headers.location!); return; }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    };
    request(url);
  });
}

/**
 * Wireless transfer helpers for the Worker node.
 *
 * download: Stream a file FROM Main → local temp path
 * upload:   Stream a transcoded file FROM local path → Main
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

export interface TransferProgress {
  bytes: number;
  total: number;
  progress: number; // 0-100
}

type OnProgress = (p: TransferProgress) => void;

/**
 * Download a file from Main to a local temp directory.
 * Returns the local path where the file was saved.
 */
export async function downloadFile(
  url: string,
  callbackToken: string,
  originalFilename: string,
  onProgress: OnProgress,
): Promise<string> {
  const ext      = path.extname(originalFilename);
  const base     = path.basename(originalFilename, ext);
  const localPath = path.join(os.tmpdir(), `transcodarr_dl_${base}_${Date.now()}${ext}`);

  await new Promise<void>((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { Authorization: `Bearer ${callbackToken}` },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }

      const total = parseInt((res.headers['content-length'] ?? res.headers['x-file-size'] ?? '0') as string);
      let bytes = 0;

      const dest = fs.createWriteStream(localPath);

      // Use a Transform passthrough to track progress while pipeline handles backpressure
      const progress$ = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length;
          if (total > 0) {
            onProgress({ bytes, total, progress: Math.min(99, Math.round((bytes / total) * 100)) });
          }
          cb(null, chunk);
        },
      });

      // pipeline() properly propagates backpressure — no unbounded buffering on slow disks
      pipeline(res, progress$, dest)
        .then(() => {
          onProgress({ bytes, total: bytes, progress: 100 });
          resolve();
        })
        .catch(reject);
    });
    req.on('error', reject);
  });

  return localPath;
}

/**
 * Upload a transcoded file back to Main.
 * Main receives it, performs the atomic swap, and marks the job complete.
 */
export async function uploadFile(
  url: string,
  callbackToken: string,
  localPath: string,
  sizeBefore: number,
  onProgress: OnProgress,
): Promise<void> {
  const stat  = fs.statSync(localPath);
  const total = stat.size;
  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === 'https:';
  const client = isHttps ? https : http;

  await new Promise<void>((resolve, reject) => {
    const reqOptions: http.RequestOptions = {
      hostname: urlObj.hostname,
      port:     urlObj.port ? parseInt(urlObj.port) : (isHttps ? 443 : 80),
      path:     urlObj.pathname + urlObj.search,
      method:   'PUT',
      headers: {
        'Content-Type':        'application/octet-stream',
        'Content-Length':      total,
        'Authorization':       `Bearer ${callbackToken}`,
        'X-Size-Before':       sizeBefore,
        'X-Output-Filename':   path.basename(localPath),
        'Transfer-Encoding':   'identity', // ensure Content-Length is respected
      },
    };

    const req = client.request(reqOptions, (res) => {
      // Drain response
      res.resume();
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: HTTP ${res.statusCode}`));
        }
      });
    });

    // Prevent indefinite hang if Main is unresponsive or connection stalls
    req.setTimeout(300_000, () => {
      req.destroy(new Error('Upload timed out after 5 minutes'));
    });

    req.on('error', reject);

    // Stream file bytes and track progress
    const src = fs.createReadStream(localPath);
    let bytes = 0;
    src.on('data', (chunk: Buffer | string) => {
      const len = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      bytes += len;
      onProgress({ bytes, total, progress: Math.min(99, Math.round((bytes / total) * 100)) });
    });
    src.on('end', () => {
      onProgress({ bytes: total, total, progress: 100 });
      req.end();
    });
    src.on('error', (err) => {
      req.destroy(err);
      reject(err);
    });
    src.pipe(req, { end: false });
  });
}

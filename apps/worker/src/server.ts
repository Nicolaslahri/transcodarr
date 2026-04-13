import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { JobPayload, HardwareProfile } from '@transcodarr/shared';
import { transcodeFile } from './transcoder.js';
import { downloadFile, uploadFile } from './transfer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let hardware: HardwareProfile;
let workerId: string;
let mainUrl: string;
export let currentJob: { jobId: string; fileName: string; progress: number; fps?: number; phase?: string } | null = null;

export function initWorkerServer(hw: HardwareProfile, wid: string, mUrl: string) {
  hardware = hw;
  workerId = wid;
  mainUrl   = mUrl;
}

export async function createWorkerServer(port: number) {
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 10 * 1024 * 1024 }); // 10MB — enough for any JSON dispatch payload
  await app.register(fastifyCors, { origin: true });

  // Serve built web UI
  const webOutPath = path.resolve(__dirname, '../../web/out');
  try {
    await app.register(fastifyStatic, { 
      root: webOutPath, 
      prefix: '/',
      extensions: ['html'] 
    });
    
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/job') || req.url.startsWith('/status') || req.url.startsWith('/health')) {
         reply.code(404).send({ error: 'Not Found', path: req.url });
         return;
      }
      const page = req.url.split('?')[0] + '.html';
      const tryPath = path.join(webOutPath, page);
      import('fs').then(fs => {
        if (fs.existsSync(tryPath)) {
          return reply.sendFile(page);
        }
        return reply.sendFile('index.html');
      });
    });
  } catch {
    // Web UI not built yet
  }

  // POST /job — receive a job from Main
  app.post<{ Body: JobPayload }>('/job', async (req, reply) => {
    const payload = req.body;
    const mode = payload.transferMode ?? (payload.smbPath ? 'smb' : 'wireless');
    console.log(`\n📥 Job received: ${payload.jobId}`);
    console.log(`   File: ${payload.smbPath ?? payload.filePath}`);
    console.log(`   Recipe: ${payload.recipe.name}`);
    console.log(`   Mode: ${mode === 'wireless' ? '📡 Wireless transfer' : '📂 SMB share'}`);

    // Respond immediately so Main doesn't time out
    reply.send({ ok: true, jobId: payload.jobId });

    // Run pipeline in background
    transcodeInBackground(payload, mode as 'smb' | 'wireless').catch(err => {
      console.error('Pipeline error:', err);
    });
  });

  // Identity — tells the Web UI it's a Worker node
  app.get('/api/meta', async () => {
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;
    return {
      mode: 'worker',
      id: workerId,
      name: process.env.WORKER_NAME ?? workerId,
      version: pkgVersion,
      hardware,
      mainUrl,
    };
  });

  // Settings stubs — Worker has only General settings (no DB)
  app.get('/api/settings/general', async () => ({
    nodeName: process.env.WORKER_NAME ?? workerId,
    mainUrl,
  }));

  app.put<{ Body: { nodeName?: string; mainUrl?: string } }>('/api/settings/general', async (req, reply) => {
    const { default: fs } = await import('fs');
    const { default: os } = await import('os');
    const { default: path } = await import('path');
    const dir        = path.join(os.homedir(), '.transcodarr');
    const configFile = path.join(dir, 'config.json');

    try {
      let config: any = { role: 'worker' };
      if (fs.existsSync(configFile)) {
        config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      }
      if (req.body.nodeName) config.nodeName = req.body.nodeName;
      if (req.body.mainUrl)  config.mainUrl = req.body.mainUrl;
      
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
      
      // Send response then exit after 500ms so start.mjs restarts it with new config
      setTimeout(() => process.exit(0), 500);
      return reply.send({ ok: true, message: 'Worker is restarting to apply changes' });
    } catch {
      return reply.status(500).send({ error: 'Failed to write config' });
    }
  });

  // Reset — writes flag file for start.mjs to detect and restart in setup mode
  app.post('/api/settings/reset', async (req, reply) => {
    const { default: fs } = await import('fs');
    const { default: os } = await import('os');
    const { default: path } = await import('path');
    const dir        = path.join(os.homedir(), '.transcodarr');
    const configFile = path.join(dir, 'config.json');
    const resetFlag  = path.join(dir, 'reset.flag');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    try { fs.writeFileSync(resetFlag, '1'); } catch {}
    try { fs.unlinkSync(configFile); } catch {}
    return reply.send({ ok: true });
  });

  // GET /status — current job state for the Worker UI
  app.get('/status', async () => ({ workerId, hardware, currentJob: currentJob ?? null }));

  // GET /health
  app.get('/health', async () => ({ ok: true, workerId, hardware }));

  // GET /fs?path= — browse worker's filesystem (used by Main UI for path mapping)
  app.get<{ Querystring: { path?: string } }>('/fs', async (req) => {
    const { default: fsSync } = await import('fs');
    const { default: pathMod } = await import('path');
    const { default: osMod }   = await import('os');
    const isWindows = osMod.platform() === 'win32';
    const q = req.query;

    if (!q.path && isWindows) {
      const drives: { name: string; path: string }[] = [];
      for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) {
        const root = `${letter}:\\`;
        try { if (fsSync.existsSync(root)) drives.push({ name: root, path: root }); } catch { /**/ }
      }
      return { current: '', parent: '', dirs: drives };
    }

    const defaultRoot = isWindows ? 'C:\\' : '/';
    let target = q.path ? pathMod.resolve(q.path) : defaultRoot;
    if (!fsSync.existsSync(target)) target = defaultRoot;

    try {
      const dirents = fsSync.readdirSync(target, { withFileTypes: true });
      const dirs = dirents
        .filter(d => {
          if (!d.isDirectory()) return false;
          if (!isWindows) {
            const skip = ['proc', 'sys', 'dev', 'run', 'snap', 'lost+found'];
            if (skip.includes(d.name)) return false;
          }
          return true;
        })
        .map(d => ({ name: d.name, path: pathMod.join(target, d.name) }));
      return { current: target, parent: pathMod.dirname(target), dirs };
    } catch {
      return { current: target, parent: pathMod.dirname(target), dirs: [] };
    }
  });

  await app.listen({ port, host: '0.0.0.0' });
  console.log(`✅ Worker HTTP server listening on :${port}`);
  return app;
}

// ─── Background pipeline ──────────────────────────────────────────────────────

async function transcodeInBackground(payload: JobPayload, mode: 'smb' | 'wireless'): Promise<void> {
  const callbackBase = mainUrl.replace(/\/$/, '');
  const progressUrl  = `${callbackBase}/api/workers/jobs/${payload.jobId}/progress`;
  const completeUrl  = `${callbackBase}/api/workers/jobs/${payload.jobId}/complete`;
  const fileName = (payload.smbPath ?? payload.filePath).split(/[\\\/]/).pop() ?? payload.filePath;

  console.log(`   Callback base: ${callbackBase}`);

  currentJob = { jobId: payload.jobId, fileName, progress: 0, phase: mode === 'wireless' ? 'receiving' : 'transcoding' };

  const sendProgress = async (progress: number, fps?: number, eta?: number, phase = 'transcoding') => {
    currentJob = { jobId: payload.jobId, fileName, progress, fps, phase };
    try {
      await fetch(progressUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ workerId, progress, fps, eta, phase }),
      });
    } catch { /* best-effort */ }
  };

  // ─── Wireless pipeline ────────────────────────────────────────────────────

  if (mode === 'wireless') {
    const downloadUrl = payload.downloadUrl!;
    const uploadUrl   = payload.uploadUrl!;
    let localInput: string | undefined;
    let localOutput: string | undefined;

    try {
      // Phase 1: Receive the file from Main
      console.log(`📡 [Wireless] Downloading from Main…`);
      await sendProgress(0, undefined, undefined, 'receiving');

      localInput = await downloadFile(
        downloadUrl,
        payload.callbackToken,
        path.basename(payload.filePath),
        async ({ progress }) => {
          await sendProgress(progress, undefined, undefined, 'receiving');
        },
      );

      console.log(`✅ File received → ${localInput}`);
      const sizeBefore = fs.statSync(localInput).size;

      // Phase 2: Transcode the local copy
      console.log(`🎬 [Wireless] Transcoding…`);
      await sendProgress(0, undefined, undefined, 'transcoding');

      const result = await transcodeFile(
        { ...payload, smbPath: localInput, filePath: localInput },
        hardware,
        async (update) => {
          await sendProgress(update.progress ?? 0, update.fps, update.eta, update.phase ?? 'transcoding');
        },
      );
      localOutput = result.outputPath;

      // Phase 3: Upload the result back to Main
      console.log(`📤 [Wireless] Uploading result → Main…`);
      await sendProgress(0, undefined, undefined, 'sending');

      await uploadFile(
        uploadUrl,
        payload.callbackToken,
        result.outputPath,
        sizeBefore,
        async ({ progress }) => {
          await sendProgress(progress, undefined, undefined, 'sending');
        },
      );

      const saved = Math.round((result.sizeBefore - result.sizeAfter) / 1e6);
      console.log(`✅ [Wireless] Done! Saved ${saved} MB`);

      // Main's /upload endpoint handles job completion & atomic swap
      // Clean up local temp files
      try { if (fs.existsSync(localInput)) fs.unlinkSync(localInput); } catch { /**/ }
      try { if (fs.existsSync(result.outputPath)) fs.unlinkSync(result.outputPath); } catch { /**/ }

    } catch (err: any) {
      // Clean up both temp files regardless of which phase failed
      try { if (localInput  && fs.existsSync(localInput))  fs.unlinkSync(localInput);  } catch { /**/ }
      try { if (localOutput && fs.existsSync(localOutput)) fs.unlinkSync(localOutput); } catch { /**/ }

      await fetch(completeUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ workerId, callbackToken: payload.callbackToken, success: false, error: err.message }),
      }).catch(() => {});
      console.error(`❌ [Wireless] Pipeline failed: ${err.message}`);
    } finally {
      currentJob = null;
    }
    return;
  }

  // ─── SMB pipeline (original) ──────────────────────────────────────────────

  try {
    const result = await transcodeFile(payload, hardware, async (update) => {
      await sendProgress(update.progress ?? 0, update.fps, update.eta, update.phase ?? 'transcoding');
    });

    await fetch(completeUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        workerId,
        callbackToken: payload.callbackToken,
        success:       true,
        outputPath:    result.outputPath,
        sizeBefore:    result.sizeBefore,
        sizeAfter:     result.sizeAfter,
      }),
    });

    const saved = Math.round((result.sizeBefore - result.sizeAfter) / 1e6);
    console.log(`✅ [SMB] Done! Saved ${saved} MB (${result.sizeBefore} → ${result.sizeAfter} bytes)`);
  } catch (err: any) {
    await fetch(completeUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ workerId, callbackToken: payload.callbackToken, success: false, error: err.message }),
    });
    console.error(`❌ [SMB] Transcoding failed: ${err.message}`);
  } finally {
    currentJob = null;
  }
}

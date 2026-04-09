import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import type { JobPayload, HardwareProfile } from '@transcodarr/shared';
import { transcodeFile } from './transcoder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let hardware: HardwareProfile;
let workerId: string;
let mainUrl: string;
export let currentJob: { jobId: string; fileName: string; progress: number; fps?: number } | null = null;

export function initWorkerServer(hw: HardwareProfile, wid: string, mUrl: string) {
  hardware = hw;
  workerId = wid;
  mainUrl   = mUrl;
}

export async function createWorkerServer(port: number) {
  const app = Fastify({ logger: { level: 'warn' } });
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
      // API or other specific routes fallback to raw index or standard 404
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
    console.log(`\n📥 Job received: ${payload.jobId}`);
    console.log(`   File: ${payload.smbPath ?? payload.filePath}`);
    console.log(`   Recipe: ${payload.recipe.name}`);
    console.log(`   SMB bypass: ${payload.smbPath ? '✅ yes' : '❌ no (will use network path)'}`);

    // Respond immediately so Main doesn't time out
    reply.send({ ok: true, jobId: payload.jobId });

    // Run transcoding in background
    transcodeInBackground(payload).catch(err => {
      console.error('Transcoder error:', err);
    });
  });

  // Identity — tells the Web UI it's a Worker node
  app.get('/api/meta', async () => ({
    mode: 'worker',
    id: workerId,
    name: process.env.WORKER_NAME ?? workerId,
    version: '1.0.1',
    hardware,
    mainUrl,
  }));

  // Settings stubs — Worker has only General settings (no DB)
  app.get('/api/settings/general', async () => ({
    nodeName: process.env.WORKER_NAME ?? workerId,
  }));

  app.put('/api/settings/general', async () => ({ ok: true }));

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

  await app.listen({ port, host: '0.0.0.0' });
  console.log(`✅ Worker HTTP server listening on :${port}`);
  return app;
}

async function transcodeInBackground(payload: JobPayload): Promise<void> {
  // Always call back to the Host that dispatched this job, not the static MAIN_URL
  const callbackBase = `http://${payload.mainHost}:${payload.mainPort}`;
  const progressUrl  = `${callbackBase}/api/workers/jobs/${payload.jobId}/progress`;
  const completeUrl  = `${callbackBase}/api/workers/jobs/${payload.jobId}/complete`;
  const fileName = (payload.smbPath ?? payload.filePath).split(/[\\/]/).pop() ?? payload.filePath;

  console.log(`   Callback base: ${callbackBase}`);

  // Track current job for /status endpoint
  currentJob = { jobId: payload.jobId, fileName, progress: 0 };

  const sendProgress = async (progress: number, fps?: number, eta?: number, phase = 'transcoding') => {
    currentJob = { jobId: payload.jobId, fileName, progress, fps };
    try {
      await fetch(progressUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ workerId, progress, fps, eta, phase }),
      });
    } catch { /* best-effort */ }
  };

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
    console.log(`✅ Done! Saved ${saved} MB (${result.sizeBefore} → ${result.sizeAfter} bytes)`);
  } catch (err: any) {
    await fetch(completeUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ workerId, callbackToken: payload.callbackToken, success: false, error: err.message }),
    });
    console.error(`❌ Transcoding failed: ${err.message}`);
  } finally {
    currentJob = null;
  }
}

import fs from 'fs';
import os from 'os';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WsEvent, WsEventType } from '@transcodarr/shared';

import { workersRoutes } from './routes/workers.js';
import { jobsRoutes } from './routes/jobs.js';
import { settingsRoutes } from './routes/settings.js';
import { getDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── WebSocket broadcast registry ─────────────────────────────────────────────

const clients = new Set<WebSocket>();

export function broadcast<T>(event: WsEventType, data: T): void {
  const payload = JSON.stringify({ event, data, timestamp: Date.now() } satisfies WsEvent<T>);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// ─── Worker Health Poller ─────────────────────────────────────────────────────

function rowToWorker(row: any) {
  return {
    id: row.id, name: row.name, host: row.host, port: row.port,
    status: row.status, hardware: JSON.parse(row.hardware ?? '{}'),
    smbMappings: JSON.parse(row.smb_mappings ?? '[]'), lastSeen: row.last_seen,
  };
}

export function startWorkerHealthPoller() {
  const INTERVAL_MS = 20_000; // ping every 20 seconds

  const tick = async () => {
    const db = getDb();
    const workers = db.prepare("SELECT * FROM workers WHERE status != 'pending'").all() as any[];
    
    await Promise.all(workers.map(async (row) => {
      const url = `http://${row.host}:${row.port}/health`;
      let newStatus: string;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        newStatus = res.ok ? 'online' : 'offline';
      } catch {
        newStatus = 'offline';
      }

      if (newStatus !== row.status) {
        db.prepare('UPDATE workers SET status = ?, last_seen = ? WHERE id = ?')
          .run(newStatus, Math.floor(Date.now() / 1000), row.id);
        broadcast('worker:updated', rowToWorker(
          db.prepare('SELECT * FROM workers WHERE id = ?').get(row.id)
        ));
      }
    }));
  };

  // Run once immediately, then on interval
  tick();
  setInterval(tick, INTERVAL_MS);
}

// ─── Server factory ───────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.transcodarr');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export async function createServer(isSetup = false) {
  const app = Fastify({ logger: { level: 'warn' } });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Serve built web UI
  const webOutPath = path.resolve(__dirname, '../../web/out');
  try {
    await app.register(fastifyStatic, { 
      root: webOutPath, 
      prefix: '/',
      extensions: ['html'] 
    });
    
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
         reply.code(404).send({ error: 'Not Found', path: req.url });
         return;
      }
      const page = req.url.split('?')[0] + '.html';
      const tryPath = path.join(webOutPath, page);
      if (fs.existsSync(tryPath)) {
        return reply.sendFile(page);
      }
      return reply.sendFile('index.html');
    });
  } catch {
    // Web UI not built yet — fine in dev
  }

  if (isSetup) {
    // Setup endpoints
    app.get('/api/meta', async () => ({ mode: 'loading_setup', name: 'Transcodarr Setup', version: '1.0.0' }));
    
    app.post<{ Body: { role: 'main' | 'worker'; mainUrl?: string } }>('/api/setup', async (req, reply) => {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const cfg: any = { role: req.body.role, savedAt: new Date().toISOString() };
      if (req.body.role === 'worker' && req.body.mainUrl) {
        cfg.mainUrl = req.body.mainUrl;
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
      reply.send({ ok: true });
      // Write reset flag so start.mjs restarts cleanly instead of turbo respawning
      const resetFlag = path.join(CONFIG_DIR, 'reset.flag');
      setTimeout(() => {
        try { fs.writeFileSync(resetFlag, '1'); } catch {}
        process.exit(0);
      }, 200);
    });
    return app;
  }

  // WebSocket endpoint
  app.get('/ws', { websocket: true }, (connection, req) => {
    const ws = connection.socket;
    clients.add(ws);
    ws.send(JSON.stringify({ event: 'connected', timestamp: Date.now() }));
    ws.on('close', () => clients.delete(ws));
  });

  // API routes
  await app.register(workersRoutes, { prefix: '/api/workers' });
  await app.register(jobsRoutes,    { prefix: '/api/jobs' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });

  // Identity endpoint — tells the Web UI it's a Main node
  app.get('/api/meta', async () => ({
    mode: 'main',
    name: process.env.NODE_NAME ?? 'Transcodarr Main',
    version: '1.0.0',
  }));

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  return app;
}

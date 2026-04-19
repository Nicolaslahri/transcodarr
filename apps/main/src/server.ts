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
import { dispatchNext } from './dispatcher.js';
import { rowToWorker } from './mappers.js';

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

export function startWorkerHealthPoller() {
  const INTERVAL_MS = 20_000; // ping every 20 seconds
  const OFFLINE_THRESHOLD = 3; // consecutive failures before marking offline

  // Track consecutive failures per worker
  const failCounts = new Map<string, number>();

  const tick = async () => {
    const db = getDb();
    const workers = db.prepare("SELECT * FROM workers WHERE status != 'pending'").all() as any[];

    await Promise.all(workers.map(async (row) => {
      const url = `http://${row.host}:${row.port}/health`;
      let reachable = false;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        reachable = res.ok;
      } catch {
        reachable = false;
      }

      if (reachable) {
        failCounts.set(row.id, 0);
        // Only update status if the worker was previously offline — preserve active/idle as-is
        if (row.status === 'offline') {
          db.prepare('UPDATE workers SET status = ?, last_seen = ? WHERE id = ?')
            .run('idle', Math.floor(Date.now() / 1000), row.id);
          broadcast('worker:updated', rowToWorker(
            db.prepare('SELECT * FROM workers WHERE id = ?').get(row.id)
          ));
          // Worker came back online — kick the dispatcher so queued jobs don't wait up to 30s
          dispatchNext().catch(() => {});
        } else {
          // Still update last_seen so we know it's alive
          db.prepare('UPDATE workers SET last_seen = ? WHERE id = ?')
            .run(Math.floor(Date.now() / 1000), row.id);
        }
      } else {
        const failures = (failCounts.get(row.id) ?? 0) + 1;
        failCounts.set(row.id, failures);
        // Only mark offline after sustained failures — avoids flipping active workers on a blip
        if (failures >= OFFLINE_THRESHOLD && row.status !== 'offline') {
          db.prepare('UPDATE workers SET status = ?, last_seen = ? WHERE id = ?')
            .run('offline', Math.floor(Date.now() / 1000), row.id);
          broadcast('worker:updated', rowToWorker(
            db.prepare('SELECT * FROM workers WHERE id = ?').get(row.id)
          ));
          failCounts.set(row.id, 0); // Reset so next recovery cycle works cleanly
        }
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
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;
    app.get('/api/meta', async () => ({ mode: 'loading_setup', name: 'Transcodarr Setup', version: pkgVersion }));
    
    // Auto-discover Main Nodes on the network
    app.get('/api/setup/discover', async () => {
      const { Bonjour } = await import('bonjour-service');
      return new Promise((resolve) => {
        const bonjour = new Bonjour();
        const browser = bonjour.find({ type: 'transcodarr-main' });
        const nodes: string[] = [];
        browser.on('up', (service) => {
          const host = service.addresses?.[0] ?? service.host;
          nodes.push(host);
        });
        setTimeout(() => {
          browser.stop();
          bonjour.destroy();
          resolve(Array.from(new Set(nodes))); // return unique IPs
        }, 1500); // 1.5 seconds is plenty for local network broadcast
      });
    });
    
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
        // Gracefully close Fastify so in-flight HTTP responses are drained before exit.
        // start.mjs monitors for process exit + the reset.flag and relaunches in the new mode.
        app.close().then(() => process.exit(0)).catch(() => process.exit(0));
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

  app.get('/api/meta', async () => {
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;
    return {
      mode: 'main',
      name: process.env.NODE_NAME ?? 'Transcodarr Main',
      version: pkgVersion,
    };
  });

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  return app;
}

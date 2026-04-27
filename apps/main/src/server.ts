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

/**
 * One-shot reconciliation pass run at Main startup.
 *
 * If Main was killed mid-completion (e.g. between a successful wireless file
 * swap and the DB transaction commit, or while writing fingerprints), there
 * may be jobs stuck in non-terminal states like `sending` / `swapping` /
 * `receiving` / `dispatched` whose worker isn't actually doing anything any
 * more — and on the wireless path, the new file may already be on disk.
 *
 * Heuristic:
 *   - If the job is in a "transferring" status and the file_path on disk
 *     exists with mtime AFTER dispatched_at, treat it as complete: the swap
 *     happened, only the DB write was missed. Mark complete and free the
 *     worker.
 *   - Otherwise, requeue it (matches the existing worker-restart semantics).
 *
 * Called once from index.ts after initDb() and BEFORE startWorkerHealthPoller.
 */
export function reconcileOrphanedJobs(): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const rows = db.prepare(
    "SELECT id, file_path, worker_id, dispatched_at, size_before FROM jobs " +
    "WHERE status IN ('dispatched','transcoding','receiving','sending','swapping')",
  ).all() as Array<{ id: string; file_path: string | null; worker_id: string | null; dispatched_at: number | null; size_before: number | null }>;

  if (rows.length === 0) return;

  let promoted = 0;
  let requeued = 0;
  for (const job of rows) {
    let recovered = false;
    if (job.file_path && fs.existsSync(job.file_path)) {
      try {
        const st = fs.statSync(job.file_path);
        const mtimeSec = Math.floor(st.mtimeMs / 1000);
        // File on disk is newer than the dispatch — the swap finished, just the DB write was missed
        if (job.dispatched_at && mtimeSec >= job.dispatched_at && st.size > 0) {
          db.exec('BEGIN');
          try {
            db.prepare(
              'UPDATE jobs SET status = ?, phase = NULL, progress = 100, size_after = ?, completed_at = ?, updated_at = ? WHERE id = ?',
            ).run('complete', st.size, now, now, job.id);
            if (job.worker_id) {
              db.prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(job.worker_id);
            }
            db.exec('COMMIT');
            console.log(`♻️  [Reconcile] Promoted "${path.basename(job.file_path)}" to complete (swap had succeeded; DB write was missed)`);
            promoted++;
            recovered = true;
          } catch (e) {
            db.exec('ROLLBACK');
            console.warn(`⚠️  [Reconcile] Failed to promote ${job.id}:`, (e as Error).message);
          }
        }
      } catch { /* stat failed — fall through to requeue */ }
    }
    if (!recovered) {
      db.prepare(
        "UPDATE jobs SET status = 'queued', worker_id = NULL, phase = NULL, progress = 0, fps = NULL, eta = NULL, error = 'Main restarted', updated_at = ? WHERE id = ?",
      ).run(now, job.id);
      if (job.worker_id) {
        db.prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(job.worker_id);
      }
      requeued++;
    }
  }
  if (promoted > 0 || requeued > 0) {
    console.log(`♻️  [Reconcile] startup pass: ${promoted} promoted to complete, ${requeued} re-queued`);
  }
}

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
const PORT_FILE   = path.join(CONFIG_DIR, 'port'); // survives config resets

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
    
    // Auto-discover Main Nodes on the network via mDNS
    app.get('/api/setup/discover', async () => {
      const { Bonjour } = await import('bonjour-service');
      return new Promise((resolve) => {
        const bonjour = new Bonjour();
        const browser = bonjour.find({ type: 'transcodarr-main' });
        const seen = new Map<string, { host: string; port: number }>();

        browser.on('up', (service) => {
          // Prefer a real routable IP over an mDNS .local hostname
          const allAddresses: string[] = service.addresses ?? [];
          const ip = allAddresses.find(a => {
            const p = a.split('.').map(Number);
            return p.length === 4                                      // IPv4
              && !(p[0] === 172 && p[1] >= 16 && p[1] <= 31)          // not Docker bridge
              && !(p[0] === 169 && p[1] === 254)                       // not link-local
              && !(p[0] === 127);                                       // not loopback
          }) ?? service.host;

          const key = `${ip}:${service.port}`;
          if (!seen.has(key)) seen.set(key, { host: ip, port: service.port });
        });

        // 4 s — enough for Pi mDNS (Avahi) which can be slower than Windows Bonjour
        setTimeout(() => {
          browser.stop();
          bonjour.destroy();
          resolve(Array.from(seen.values()));
        }, 4000);
      });
    });
    
    app.post<{ Body: { role: 'main' | 'worker'; mainUrl?: string; port?: number } }>('/api/setup', async (req, reply) => {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const cfg: any = { role: req.body.role, savedAt: new Date().toISOString() };
      if (req.body.role === 'worker' && req.body.mainUrl) {
        cfg.mainUrl = req.body.mainUrl;
      }
      // Persist the chosen port separately — survives future config resets so the
      // node always comes back on the same port (setup and role both use it).
      const chosenPort = req.body.port;
      if (chosenPort && chosenPort >= 1 && chosenPort <= 65535) {
        fs.writeFileSync(PORT_FILE, String(chosenPort));
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

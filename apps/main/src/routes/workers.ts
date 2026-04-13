import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import { broadcast } from '../server.js';
import type { WorkerInfo, SmbMapping, ConnectionMode } from '@transcodarr/shared';
import fs from 'fs';
import path from 'path';

function rowToWorker(row: any): WorkerInfo {
  return {
    id:             row.id,
    name:           row.name,
    host:           row.host,
    port:           row.port,
    status:         row.status,
    hardware:       JSON.parse(row.hardware ?? '{}'),
    smbMappings:    JSON.parse(row.smb_mappings ?? '[]'),
    connectionMode: (row.connection_mode ?? 'smb') as ConnectionMode,
    lastSeen:       row.last_seen,
  };
}

export async function workersRoutes(app: FastifyInstance) {
  // GET /api/workers — list all workers
  app.get('/', async () => {
    return (getDb().prepare('SELECT * FROM workers ORDER BY last_seen DESC').all() as any[]).map(rowToWorker);
  });

  // POST /api/workers/scan — Force re-scan (handled implicitly via mDNS polling long-term, for now just a no-op that UI uses to trigger refresh)
  app.post('/scan', async () => ({ ok: true }));

  // POST /api/workers/add-manual — Manually add a worker by IP
  app.post<{ Body: { ip: string; port?: number } }>('/add-manual', async (req, reply) => {
    try {
      const { ip } = req.body;
      const port = req.body.port ?? 3002; // Workers auto-shift to 3002+ when Main owns 3001
      const res = await fetch(`http://${ip}:${port}/api/meta`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Worker not responding on ${ip}:${port}`);
      
      const meta = await res.json() as any;
      if (meta.mode !== 'worker') throw new Error(`Not a worker node (got mode: ${meta.mode})`);

      const db = getDb();
      const workerId = meta.id ?? meta.name;
      const existing = db.prepare('SELECT id FROM workers WHERE id = ?').get(workerId);
      
      if (!existing) {
        db.prepare(`INSERT INTO workers (id, name, host, port, status, hardware, last_seen) VALUES (?,?,?,?,'pending',?,?)`)
          .run(workerId, meta.name, ip, port, JSON.stringify(meta.hardware ?? {}), Math.floor(Date.now() / 1000));
        broadcast('worker:discovered', rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId) as any));
      } else {
        // Update existing (might have changed port/IP)
        db.prepare('UPDATE workers SET host = ?, port = ?, last_seen = ? WHERE id = ?')
          .run(ip, port, Math.floor(Date.now() / 1000), workerId);
      }
      return { ok: true };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  // POST /api/workers/register — called by Worker on boot (fallback if mDNS fails)
  app.post<{ Body: { id: string; name: string; host: string; port: number; hardware: any } }>(
    '/register',
    async (req) => {
      const { id, name, host, port, hardware } = req.body;
      const realHost = req.ip && req.ip !== '127.0.0.1' && req.ip !== '::1' ? req.ip : host;
      const db = getDb();

      const existing = db.prepare('SELECT id, status FROM workers WHERE id = ?').get(id) as any;
      if (existing) {
        // If it was previously accepted, transition smoothly back to idle (skipping pending)
        // Note: include 'online' to recover any workers corrupted by the old health poller
        const wasAccepted = ['idle', 'active', 'offline', 'online'].includes(existing.status);
        const newStatus = wasAccepted ? 'idle' : existing.status;
        db.prepare('UPDATE workers SET host = ?, port = ?, hardware = ?, last_seen = ?, status = ? WHERE id = ?')
          .run(realHost, port, JSON.stringify(hardware), Math.floor(Date.now() / 1000), newStatus, id);
        if (wasAccepted) {
          broadcast('worker:updated', rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(id) as any));
          console.log(`🔄 Worker re-registered (HTTP): ${name} → ${newStatus}`);
        }
      } else {
        db.prepare(`INSERT INTO workers (id, name, host, port, status, hardware, last_seen) VALUES (?,?,?,?,'pending',?,?)`)
          .run(id, name, realHost, port, JSON.stringify(hardware), Math.floor(Date.now() / 1000));
        broadcast('worker:discovered', rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(id) as any));
        console.log(`🔍 New worker registered (HTTP): ${name} (${realHost}:${port})`);
      }
      return { ok: true };
    },
  );

  // POST /api/workers/:id/accept — accept a pending worker
  app.post<{ Params: { id: string } }>('/:id/accept', async (req) => {
    const db = getDb();
    db.prepare("UPDATE workers SET status = 'idle', accepted_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000), req.params.id);
    const worker = rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(req.params.id));
    broadcast('worker:accepted', worker);
    return worker;
  });

  // POST /api/workers/:id/reject — reject and remove a worker
  app.post<{ Params: { id: string } }>('/:id/reject', async (req) => {
    getDb().prepare('DELETE FROM workers WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // PUT /api/workers/:id/connection — update connection mode and SMB mappings for a worker
  app.put<{ Params: { id: string }; Body: { connectionMode: ConnectionMode; mappings?: SmbMapping[] } }>(
    '/:id/connection',
    async (req) => {
      const db = getDb();
      const { connectionMode, mappings } = req.body;
      db.prepare('UPDATE workers SET connection_mode = ?, smb_mappings = ? WHERE id = ?')
        .run(connectionMode, JSON.stringify(mappings ?? []), req.params.id);
      const worker = rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(req.params.id) as any);
      broadcast('worker:updated', worker);
      return { ok: true };
    },
  );

  // PUT /api/workers/:id/mappings — legacy alias kept for backward compat
  app.put<{ Params: { id: string }; Body: { mappings: SmbMapping[] } }>(
    '/:id/mappings',
    async (req) => {
      const db = getDb();
      db.prepare('UPDATE workers SET smb_mappings = ? WHERE id = ?')
        .run(JSON.stringify(req.body.mappings), req.params.id);
      const worker = rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(req.params.id) as any);
      broadcast('worker:updated', worker);
      return { ok: true };
    },
  );

  // POST /api/workers/:id/heartbeat — worker keepalive
  app.post<{ Params: { id: string } }>('/:id/heartbeat', async (req) => {
    getDb().prepare('UPDATE workers SET last_seen = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000), req.params.id);
    return { ok: true };
  });

  // GET /api/workers/:id/fs — proxy worker filesystem browser (avoids browser CORS)
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/:id/fs', async (req, reply) => {
    const worker = getDb().prepare('SELECT host, port FROM workers WHERE id = ?').get(req.params.id) as any;
    if (!worker) return reply.status(404).send({ error: 'Worker not found' });
    try {
      const qs  = req.query.path ? `?path=${encodeURIComponent(req.query.path)}` : '';
      const res = await fetch(`http://${worker.host}:${worker.port}/fs${qs}`, { signal: AbortSignal.timeout(5000) });
      const json = await res.json();
      return json;
    } catch (err: any) {
      return reply.status(502).send({ error: `Worker unreachable: ${err.message}` });
    }
  });

  // POST /api/workers/jobs/:jobId/progress — progress callback from Worker
  app.post<{ Params: { jobId: string }; Body: { workerId: string; progress: number; fps?: number; eta?: number; phase: string } }>(
    '/jobs/:jobId/progress',
    async (req) => {
      const { workerId, progress, fps, eta, phase } = req.body;
      const db = getDb();
      const activeStatus = ['receiving', 'transcoding', 'swapping'].includes(phase) ? phase
        : phase === 'sending' ? 'sending'
        : 'dispatched';
      db.prepare('UPDATE jobs SET progress = ?, fps = ?, eta = ?, phase = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(progress, fps ?? null, eta ?? null, phase, activeStatus === 'transcoding' ? 'transcoding' : 'dispatched', Math.floor(Date.now() / 1000), req.params.jobId);
      broadcast('job:progress', { jobId: req.params.jobId, workerId, progress, fps, eta, phase });
      broadcast('worker:progress', { workerId, progress, fps, eta, phase });
      return { ok: true };
    },
  );

  // POST /api/workers/jobs/:jobId/complete — job done callback from Worker (SMB mode)
  app.post<{ Params: { jobId: string }; Body: { workerId: string; callbackToken: string; success: boolean; outputPath?: string; sizeBefore?: number; sizeAfter?: number; error?: string } }>(
    '/jobs/:jobId/complete',
    async (req) => {
      const { workerId, success, outputPath, sizeBefore, sizeAfter, error } = req.body;
      const db = getDb();
      const now = Math.floor(Date.now() / 1000);

      if (success) {
        const job = db.prepare('SELECT file_path FROM jobs WHERE id = ?').get(req.params.jobId) as any;
        let targetDbPath = job?.file_path;
        if (targetDbPath && outputPath) {
            import('path').then(pathMod => {
                const newExt = pathMod.extname(outputPath);
                const oldExt = pathMod.extname(targetDbPath);
                if (newExt && newExt !== oldExt) {
                    targetDbPath = targetDbPath.slice(0, -oldExt.length) + newExt;
                    const newBase = pathMod.basename(targetDbPath);
                    db.prepare('UPDATE jobs SET file_path = ?, file_name = ? WHERE id = ?')
                      .run(targetDbPath, newBase, req.params.jobId);
                }
            });
        }
        db.prepare('UPDATE jobs SET status = ?, phase = NULL, progress = 100, size_before = ?, size_after = ?, completed_at = ?, updated_at = ? WHERE id = ?')
          .run('complete', sizeBefore ?? null, sizeAfter ?? null, now, now, req.params.jobId);
        broadcast('job:complete', { jobId: req.params.jobId, sizeBefore, sizeAfter });
      } else {
        db.prepare('UPDATE jobs SET status = ?, phase = NULL, error = ?, updated_at = ? WHERE id = ?')
          .run('failed', error ?? 'Unknown error', now, req.params.jobId);
        broadcast('job:failed', { jobId: req.params.jobId, error });
      }

      db.prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(workerId);
      return { ok: true };
    },
  );

  // GET /api/workers/jobs/:jobId/download — worker streams source file (wireless mode)
  app.get<{ Params: { jobId: string }; Headers: { authorization?: string } }>(
    '/jobs/:jobId/download',
    async (req, reply) => {
      const db = getDb();
      const job = db.prepare('SELECT file_path, worker_id FROM jobs WHERE id = ?').get(req.params.jobId) as any;
      if (!job) return reply.status(404).send({ error: 'Job not found' });

      const filePath = job.file_path;
      if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'File not found on Main' });

      const stat = fs.statSync(filePath);
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', stat.size);
      reply.header('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
      reply.header('X-File-Size', stat.size);

      // Update job phase to 'receiving' (from worker's perspective)
      db.prepare("UPDATE jobs SET phase = 'receiving', status = 'dispatched', updated_at = ? WHERE id = ?")
        .run(Math.floor(Date.now() / 1000), req.params.jobId);
      broadcast('job:progress', { jobId: req.params.jobId, progress: 0, phase: 'receiving' });

      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
    },
  );

  // PUT /api/workers/jobs/:jobId/upload — worker uploads transcoded result (wireless mode)
  app.put<{ Params: { jobId: string }; Headers: { authorization?: string; 'x-size-before'?: string; 'x-output-filename'?: string } }>(
    '/jobs/:jobId/upload',
    async (req, reply) => {
      const db = getDb();
      const job = db.prepare('SELECT file_path, worker_id FROM jobs WHERE id = ?').get(req.params.jobId) as any;
      if (!job) return reply.status(404).send({ error: 'Job not found' });

      const origPath   = job.file_path;
      const sizeBefore = parseInt(req.headers['x-size-before'] ?? '0') || fs.existsSync(origPath) ? fs.statSync(origPath).size : 0;
      const outFilename = req.headers['x-output-filename'] as string | undefined;
      const ext         = outFilename ? path.extname(outFilename) : path.extname(origPath);
      const base        = path.basename(origPath, path.extname(origPath));
      const dir         = path.dirname(origPath);
      const tmpPath     = path.join(dir, `${base}.wireless_tmp${ext}`);
      const finalPath   = path.join(dir, `${base}${ext}`);

      // Update phase to 'sending' while receiving the upload
      db.prepare("UPDATE jobs SET phase = 'sending', updated_at = ? WHERE id = ?")
        .run(Math.floor(Date.now() / 1000), req.params.jobId);

      try {
        // Stream the upload body to a temp file
        const writeStream = fs.createWriteStream(tmpPath);
        await new Promise<void>((resolve, reject) => {
          req.raw.pipe(writeStream);
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
          req.raw.on('error', reject);
        });

        const sizeAfter = fs.statSync(tmpPath).size;
        const now = Math.floor(Date.now() / 1000);

        // Atomic swap: original → .bak → tmp → final → delete .bak
        const bakPath = origPath + '.bak';
        if (fs.existsSync(origPath)) fs.renameSync(origPath, bakPath);
        fs.renameSync(tmpPath, finalPath);
        if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);

        // Update extension in DB if changed
        if (finalPath !== origPath) {
          db.prepare('UPDATE jobs SET file_path = ?, file_name = ? WHERE id = ?')
            .run(finalPath, path.basename(finalPath), req.params.jobId);
        }

        db.prepare('UPDATE jobs SET status = ?, phase = NULL, progress = 100, size_before = ?, size_after = ?, completed_at = ?, updated_at = ? WHERE id = ?')
          .run('complete', sizeBefore, sizeAfter, now, now, req.params.jobId);
        db.prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(job.worker_id);
        broadcast('job:complete', { jobId: req.params.jobId, sizeBefore, sizeAfter });

        return { ok: true };
      } catch (err: any) {
        // Clean up tmp if it exists
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /**/ }
        const now = Math.floor(Date.now() / 1000);
        db.prepare('UPDATE jobs SET status = ?, phase = NULL, error = ?, updated_at = ? WHERE id = ?')
          .run('failed', err.message, now, req.params.jobId);
        db.prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(job.worker_id);
        broadcast('job:failed', { jobId: req.params.jobId, error: err.message });
        return reply.status(500).send({ error: err.message });
      }
    },
  );
}

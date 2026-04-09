import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import { broadcast } from '../server.js';
import type { WorkerInfo, SmbMapping } from '@transcodarr/shared';

function rowToWorker(row: any): WorkerInfo {
  return {
    id:          row.id,
    name:        row.name,
    host:        row.host,
    port:        row.port,
    status:      row.status,
    hardware:    JSON.parse(row.hardware ?? '{}'),
    smbMappings: JSON.parse(row.smb_mappings ?? '[]'),
    lastSeen:    row.last_seen,
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
  app.post<{ Body: { ip: string } }>('/add-manual', async (req, reply) => {
    try {
      const { ip } = req.body;
      const port = 3001; // default worker port
      const res = await fetch(`http://${ip}:${port}/api/meta`);
      if (!res.ok) throw new Error('Worker not responding');
      
      const meta = await res.json() as any;
      if (meta.mode !== 'worker') throw new Error('Not a worker node');

      const db = getDb();
      const existing = db.prepare('SELECT id FROM workers WHERE id = ?').get(meta.name);
      
      if (!existing) {
        db.prepare(`INSERT INTO workers (id, name, host, port, status, hardware, last_seen) VALUES (?,?,?,?,'pending',?,?)`)
          .run(meta.name, meta.name, ip, port, JSON.stringify(meta.hardware ?? {}), Math.floor(Date.now() / 1000));
        broadcast('worker:discovered', rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(meta.name)));
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

      const existing = db.prepare('SELECT id FROM workers WHERE id = ?').get(id);
      if (existing) {
        db.prepare('UPDATE workers SET host = ?, port = ?, hardware = ?, last_seen = ? WHERE id = ?')
          .run(realHost, port, JSON.stringify(hardware), Math.floor(Date.now() / 1000), id);
      } else {
        db.prepare(`INSERT INTO workers (id, name, host, port, status, hardware, last_seen) VALUES (?,?,?,?,'pending',?,?)`)
          .run(id, name, realHost, port, JSON.stringify(hardware), Math.floor(Date.now() / 1000));
        broadcast('worker:discovered', rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(id)));
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

  // PUT /api/workers/:id/mappings — update SMB mappings for a worker
  app.put<{ Params: { id: string }; Body: { mappings: SmbMapping[] } }>(
    '/:id/mappings',
    async (req) => {
      getDb().prepare('UPDATE workers SET smb_mappings = ? WHERE id = ?')
        .run(JSON.stringify(req.body.mappings), req.params.id);
      return { ok: true };
    },
  );

  // POST /api/workers/:id/heartbeat — worker keepalive
  app.post<{ Params: { id: string } }>('/:id/heartbeat', async (req) => {
    getDb().prepare('UPDATE workers SET last_seen = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000), req.params.id);
    return { ok: true };
  });

  // POST /api/workers/jobs/:jobId/progress — progress callback from Worker
  app.post<{ Params: { jobId: string }; Body: { workerId: string; progress: number; fps?: number; eta?: number; phase: string } }>(
    '/jobs/:jobId/progress',
    async (req) => {
      const { workerId, progress, fps, eta, phase } = req.body;
      const db = getDb();
      db.prepare('UPDATE jobs SET progress = ?, fps = ?, eta = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(progress, fps ?? null, eta ?? null, phase === 'transcoding' ? 'transcoding' : 'dispatched', Math.floor(Date.now() / 1000), req.params.jobId);
      broadcast('job:progress', { jobId: req.params.jobId, workerId, progress, fps, eta, phase });
      return { ok: true };
    },
  );

  // POST /api/workers/jobs/:jobId/complete — job done callback from Worker
  app.post<{ Params: { jobId: string }; Body: { workerId: string; success: boolean; sizeBefore?: number; sizeAfter?: number; error?: string } }>(
    '/jobs/:jobId/complete',
    async (req) => {
      const { workerId, success, sizeBefore, sizeAfter, error } = req.body;
      const db = getDb();
      const now = Math.floor(Date.now() / 1000);

      if (success) {
        db.prepare('UPDATE jobs SET status = ?, progress = 100, size_before = ?, size_after = ?, completed_at = ?, updated_at = ? WHERE id = ?')
          .run('complete', sizeBefore ?? null, sizeAfter ?? null, now, now, req.params.jobId);
        broadcast('job:complete', { jobId: req.params.jobId, sizeBefore, sizeAfter });
      } else {
        db.prepare('UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?')
          .run('failed', error ?? 'Unknown error', now, req.params.jobId);
        broadcast('job:failed', { jobId: req.params.jobId, error });
      }

      db.prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(workerId);
      return { ok: true };
    },
  );
}

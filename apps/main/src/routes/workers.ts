import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import { broadcast } from '../server.js';
import { dispatchNext } from '../dispatcher.js';
import { getStats, recordProcessedFile, getJob, recordJobEvent } from '../queue.js';
import { fireWebhooks } from '../webhooks.js';
import type { WorkerInfo, SmbMapping, ConnectionMode } from '@transcodarr/shared';
import { ProgressUpdateSchema, JobCompletePayloadSchema } from '@transcodarr/shared';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MAIN_VERSION: string = (() => {
  try { return require('../../../package.json').version; } catch { return 'unknown'; }
})();

function rowToWorker(row: any): WorkerInfo {
  const workerVersion    = row.version ?? undefined;
  const versionMismatch  = workerVersion != null && workerVersion !== MAIN_VERSION;
  return {
    id:              row.id,
    name:            row.name,
    host:            row.host,
    port:            row.port,
    status:          row.status,
    hardware:        JSON.parse(row.hardware ?? '{}'),
    smbMappings:     JSON.parse(row.smb_mappings ?? '[]'),
    connectionMode:  (row.connection_mode ?? 'smb') as ConnectionMode,
    lastSeen:        row.last_seen,
    version:         workerVersion,
    versionMismatch,
  };
}

/**
 * Perform a version + capability sanity check between Main and a newly
 * connecting worker. Broadcasts warning toasts for the UI if anything
 * looks wrong, but never blocks the connection.
 */
function sanityCheck(workerId: string, workerName: string, workerVersion?: string): void {
  if (!workerVersion) return; // old worker without version reporting — skip

  if (workerVersion !== MAIN_VERSION) {
    const msg = `${workerName} is running v${workerVersion} but Main is v${MAIN_VERSION}. `
      + `Update both nodes to the same version to avoid compatibility issues.`;
    console.warn(`⚠️  [Sanity] Version mismatch with ${workerName}: worker=${workerVersion} main=${MAIN_VERSION}`);
    broadcast('worker:updated', rowToWorker(getDb().prepare('SELECT * FROM workers WHERE id = ?').get(workerId) as any));
    broadcast('system:warning', { title: 'Worker version mismatch', message: msg, workerId });
  } else {
    console.log(`✅ [Sanity] ${workerName} version OK (v${workerVersion})`);
  }
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
      
      const workerVersion = meta.version ?? undefined;
      if (!existing) {
        const autoAccept = (db.prepare("SELECT value FROM settings WHERE key = 'autoAcceptWorkers'").get() as any)?.value === 'true';
        const initialStatus = autoAccept ? 'idle' : 'pending';
        const nowMs = Math.floor(Date.now() / 1000);
        db.prepare(`INSERT INTO workers (id, name, host, port, status, hardware, last_seen, version) VALUES (?,?,?,?,?,?,?,?)`)
          .run(workerId, meta.name, ip, port, initialStatus, JSON.stringify(meta.hardware ?? {}), nowMs, workerVersion ?? null);
        if (autoAccept) {
          db.prepare('UPDATE workers SET accepted_at = ? WHERE id = ?').run(nowMs, workerId);
          broadcast('worker:accepted', rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId) as any));
          dispatchNext().catch(() => {});
        } else {
          broadcast('worker:discovered', rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId) as any));
        }
      } else {
        // Update existing (might have changed port/IP)
        db.prepare('UPDATE workers SET host = ?, port = ?, last_seen = ?, version = ? WHERE id = ?')
          .run(ip, port, Math.floor(Date.now() / 1000), workerVersion ?? null, workerId);
      }
      return { ok: true };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  // POST /api/workers/register — called by Worker on boot (fallback if mDNS fails)
  app.post<{ Body: { id: string; name: string; host: string; port: number; hardware: any; version?: string } }>(
    '/register',
    async (req) => {
      const { id, name, host, port, hardware, version } = req.body;
      const realHost = req.ip && req.ip !== '127.0.0.1' && req.ip !== '::1' ? req.ip : host;
      const db = getDb();

      const existing = db.prepare('SELECT id, status FROM workers WHERE id = ?').get(id) as any;
      if (existing) {
        const wasAccepted = ['idle', 'active', 'offline', 'online'].includes(existing.status);
        const newStatus = wasAccepted ? 'idle' : existing.status;
        const now = Math.floor(Date.now() / 1000);
        db.prepare('UPDATE workers SET host = ?, port = ?, hardware = ?, last_seen = ?, status = ?, version = ? WHERE id = ?')
          .run(realHost, port, JSON.stringify(hardware), now, newStatus, version ?? null, id);
        if (wasAccepted) {
          // Re-queue any jobs that were orphaned when this worker went offline/restarted.
          // The worker lost its ffmpeg process so those jobs can never complete — put them back in queue.
          const orphaned = db.prepare(
            "SELECT id FROM jobs WHERE worker_id = ? AND status IN ('dispatched','transcoding','receiving','sending','swapping')"
          ).all(id) as any[];
          for (const row of orphaned) {
            db.prepare(
              "UPDATE jobs SET status = 'queued', worker_id = NULL, phase = NULL, progress = 0, fps = NULL, eta = NULL, error = 'Worker restarted', updated_at = ? WHERE id = ?"
            ).run(now, row.id);
            broadcast('job:queued', getJob(row.id));
          }
          if (orphaned.length > 0) {
            console.log(`♻️  Re-queued ${orphaned.length} orphaned job(s) from ${name}`);
            dispatchNext().catch(() => {});
          }
          broadcast('worker:updated', rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(id) as any));
          console.log(`🔄 Worker re-registered (HTTP): ${name} v${version ?? '?'} → ${newStatus}`);
          sanityCheck(id, name, version);
        }
      } else {
        // Check if auto-accept is enabled — if so, skip the approval queue
        const autoAccept = (db.prepare("SELECT value FROM settings WHERE key = 'autoAcceptWorkers'").get() as any)?.value === 'true';
        const initialStatus = autoAccept ? 'idle' : 'pending';
        const now = Math.floor(Date.now() / 1000);
        db.prepare(`INSERT INTO workers (id, name, host, port, status, hardware, last_seen, version) VALUES (?,?,?,?,?,?,?,?)`)
          .run(id, name, realHost, port, initialStatus, JSON.stringify(hardware), now, version ?? null);
        if (autoAccept) {
          db.prepare('UPDATE workers SET accepted_at = ? WHERE id = ?').run(now, id);
          broadcast('worker:accepted', rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(id) as any));
          console.log(`✅ New worker auto-accepted: ${name} v${version ?? '?'} (${realHost}:${port})`);
          dispatchNext().catch(() => {});
        } else {
          broadcast('worker:discovered', rowToWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(id) as any));
          console.log(`🔍 New worker registered (HTTP): ${name} v${version ?? '?'} (${realHost}:${port})`);
        }
      }
      return { ok: true, mainVersion: MAIN_VERSION };
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

  // POST /api/workers/:id/heartbeat — worker keepalive (optionally carries GPU stats)
  app.post<{ Params: { id: string }; Body: { gpuStats?: { utilPct: number; tempC: number; vramUsedMB: number; vramTotalMB: number } } }>(
    '/:id/heartbeat',
    async (req) => {
      getDb().prepare('UPDATE workers SET last_seen = ? WHERE id = ?')
        .run(Math.floor(Date.now() / 1000), req.params.id);

      // Broadcast GPU stats to the browser (best-effort; no DB persistence needed)
      if (req.body?.gpuStats) {
        broadcast('worker:stats', { workerId: req.params.id, gpuStats: req.body.gpuStats });
      }
      return { ok: true };
    },
  );

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
  app.post<{ Params: { jobId: string }; Headers: { authorization?: string }; Body: { workerId: string; progress: number; fps?: number; eta?: number; phase: string; gpuStats?: { utilPct: number; tempC: number; vramUsedMB: number; vramTotalMB: number } } }>(
    '/jobs/:jobId/progress',
    async (req, reply) => {
      const parsed = ProgressUpdateSchema.safeParse({ ...req.body, jobId: req.params.jobId });
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid progress payload', details: parsed.error.flatten() });
      const { workerId, progress, fps, eta, phase, gpuStats } = { ...req.body, ...parsed.data } as any;
      const db = getDb();
      const jobRow = db.prepare('SELECT callback_token FROM jobs WHERE id = ?').get(req.params.jobId) as any;
      if (jobRow?.callback_token) {
        const provided = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        if (provided !== jobRow.callback_token) return reply.status(401).send({ error: 'Unauthorized' });
      }
      // Map phase → valid JobStatus for DB storage
      const dbStatus =
        phase === 'transcoding' ? 'transcoding' :
        phase === 'swapping'    ? 'swapping'    :
        'dispatched'; // receiving / sending stay as 'dispatched' in DB; phase field carries the detail
      db.prepare('UPDATE jobs SET progress = ?, fps = ?, eta = ?, phase = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(progress, fps ?? null, eta ?? null, phase, dbStatus, Math.floor(Date.now() / 1000), req.params.jobId);
      // Terminal progress display on Main
      const PHASE_DISPLAY: Record<string, string> = {
        transcoding: 'Transcoding',
        swapping:    'Swapping',
        receiving:   'Downloading',
        sending:     'Uploading',
      };
      const phaseLabel = PHASE_DISPLAY[phase] ?? phase;
      const fpsStr  = fps != null ? ` · ${fps.toFixed(1)} fps` : '';
      const bar     = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
      process.stdout.write(`\r   [Main] ${phaseLabel} [${bar}] ${progress}%${fpsStr}   `);
      if (progress >= 99) process.stdout.write('\n');

      broadcast('job:progress', { jobId: req.params.jobId, workerId, progress, fps, eta, phase, status: dbStatus });
      broadcast('worker:progress', { workerId, progress, fps, eta, phase });
      // Piggyback GPU stats onto every progress update — gives ~500ms refresh rate
      // during active transcoding instead of the 30s heartbeat interval.
      if (gpuStats) broadcast('worker:stats', { workerId, gpuStats });
      return { ok: true };
    },
  );

  // POST /api/workers/jobs/:jobId/complete — job done callback from Worker (SMB mode)
  app.post<{ Params: { jobId: string }; Body: { workerId: string; callbackToken: string; success: boolean; outputPath?: string; sizeBefore?: number; sizeAfter?: number; error?: string } }>(
    '/jobs/:jobId/complete',
    async (req, reply) => {
      const parsedComplete = JobCompletePayloadSchema.safeParse({ ...req.body, jobId: req.params.jobId });
      if (!parsedComplete.success) return reply.status(400).send({ error: 'Invalid complete payload', details: parsedComplete.error.flatten() });
      const { workerId, callbackToken, success, outputPath, sizeBefore, sizeAfter, error } = parsedComplete.data;
      const db = getDb();
      const jobRow = db.prepare('SELECT file_path, callback_token, status FROM jobs WHERE id = ?').get(req.params.jobId) as any;
      if (jobRow?.callback_token && callbackToken !== jobRow.callback_token) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      // If the job was paused (or somehow already re-queued) the failure callback is expected.
      // Don't overwrite its status — just release the worker so the next job can dispatch.
      if (!success && (jobRow?.status === 'queued' || jobRow?.status === 'paused')) {
        db.prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(workerId);
        dispatchNext().catch(() => {});
        return { ok: true };
      }

      const now = Math.floor(Date.now() / 1000);
      const jobFull = db.prepare('SELECT file_path, recipe, fps, dispatched_at, content_key FROM jobs WHERE id = ?').get(req.params.jobId) as any;
      const elapsed = jobFull?.dispatched_at ? now - jobFull.dispatched_at : null;

      if (success) {
        let targetDbPath = jobRow?.file_path;
        if (targetDbPath && outputPath) {
          const newExt = path.extname(outputPath);
          const oldExt = path.extname(targetDbPath);
          if (newExt && newExt !== oldExt) {
            targetDbPath = targetDbPath.slice(0, -oldExt.length) + newExt;
            db.prepare('UPDATE jobs SET file_path = ?, file_name = ? WHERE id = ?')
              .run(targetDbPath, path.basename(targetDbPath), req.params.jobId);
          }
        }
        db.prepare('UPDATE jobs SET status = ?, phase = NULL, progress = 100, size_before = ?, size_after = ?, avg_fps = ?, elapsed_seconds = ?, completed_at = ?, updated_at = ? WHERE id = ?')
          .run('complete', sizeBefore ?? null, sizeAfter ?? null, jobFull?.fps ?? null, elapsed, now, now, req.params.jobId);
        // Persist fingerprint so "Clear All" doesn't re-queue this file
        if (jobFull) recordProcessedFile(jobFull.file_path, sizeBefore ?? 0, jobFull.recipe, jobFull.content_key ?? undefined);
        // Post-processing: move file if the source watched path has move_to configured
        if (targetDbPath && fs.existsSync(targetDbPath)) {
          const moveTo = (db.prepare(
            "SELECT move_to FROM watched_paths WHERE ? LIKE path || '%' AND move_to IS NOT NULL ORDER BY LENGTH(path) DESC LIMIT 1"
          ).get(jobFull?.file_path ?? targetDbPath) as any)?.move_to as string | undefined;
          if (moveTo) {
            try {
              fs.mkdirSync(moveTo, { recursive: true });
              const dest = path.join(moveTo, path.basename(targetDbPath));
              fs.renameSync(targetDbPath, dest);
              db.prepare('UPDATE jobs SET file_path = ?, file_name = ? WHERE id = ?')
                .run(dest, path.basename(dest), req.params.jobId);
            } catch (moveErr: any) {
              console.warn(`⚠️  move_to failed: ${moveErr.message}`);
            }
          }
        }
        const completeName = jobFull?.file_path ? path.basename(jobFull.file_path) : undefined;
        broadcast('job:complete', { jobId: req.params.jobId, sizeBefore, sizeAfter, fileName: completeName });
        broadcast('stats:update', getStats());
        fireWebhooks('job:complete', { jobId: req.params.jobId, fileName: completeName ?? '', sizeBefore, sizeAfter });
      } else {
        db.prepare('UPDATE jobs SET status = ?, phase = NULL, error = ?, updated_at = ? WHERE id = ?')
          .run('failed', error ?? 'Unknown error', now, req.params.jobId);
        const failedName = jobFull?.file_path ? path.basename(jobFull.file_path) : undefined;
        broadcast('job:failed', { jobId: req.params.jobId, error, fileName: failedName });
        broadcast('stats:update', getStats());
        fireWebhooks('job:failed', { jobId: req.params.jobId, fileName: failedName ?? '', error });
      }

      db.prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(workerId);
      // Trigger next job immediately rather than waiting for the 30s poll
      dispatchNext().catch(() => {});
      return { ok: true };
    },
  );

  // GET /api/workers/jobs/:jobId/download — worker streams source file (wireless mode)
  app.get<{ Params: { jobId: string }; Headers: { authorization?: string } }>(
    '/jobs/:jobId/download',
    async (req, reply) => {
      const db = getDb();
      const job = db.prepare('SELECT file_path, worker_id, callback_token FROM jobs WHERE id = ?').get(req.params.jobId) as any;
      if (!job) return reply.status(404).send({ error: 'Job not found' });
      if (job.callback_token) {
        const provided = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        if (provided !== job.callback_token) return reply.status(401).send({ error: 'Unauthorized' });
      }

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
      broadcast('job:progress', { jobId: req.params.jobId, progress: 0, phase: 'receiving', status: 'dispatched' });

      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
    },
  );

  // PUT /api/workers/jobs/:jobId/upload — worker uploads transcoded result (wireless mode)
  app.put<{ Params: { jobId: string }; Headers: { authorization?: string; 'x-size-before'?: string; 'x-output-filename'?: string } }>(
    '/jobs/:jobId/upload',
    async (req, reply) => {
      const db = getDb();
      const job = db.prepare('SELECT file_path, worker_id, callback_token FROM jobs WHERE id = ?').get(req.params.jobId) as any;
      if (!job) return reply.status(404).send({ error: 'Job not found' });
      if (job.callback_token) {
        const provided = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        if (provided !== job.callback_token) return reply.status(401).send({ error: 'Unauthorized' });
      }

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
        const jobMeta = db.prepare('SELECT file_path, recipe, fps, dispatched_at, content_key FROM jobs WHERE id = ?').get(req.params.jobId) as any;
        const elapsed = jobMeta?.dispatched_at ? now - jobMeta.dispatched_at : null;

        // Atomic swap: original → .bak → tmp → final → delete .bak
        const bakPath = origPath + '.bak';
        try {
          if (fs.existsSync(origPath)) fs.renameSync(origPath, bakPath);
          fs.renameSync(tmpPath, finalPath);
          if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
        } catch (swapErr: any) {
          // Rollback: restore .bak to original path so we don't lose the source file
          try {
            if (fs.existsSync(bakPath)) {
              fs.renameSync(bakPath, origPath);
              console.error('[Main] Swap failed — restored backup from .bak');
            }
          } catch (restoreErr) {
            console.error('[Main] CRITICAL: swap failed AND restore failed — manual recovery needed:', restoreErr);
          }
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
          throw swapErr;
        }

        // Wrap all DB writes atomically so a crash can't leave them half-applied
        const wirelessName = jobMeta?.file_path ? path.basename(jobMeta.file_path) : undefined;
        db.exec('BEGIN');
        try {
          // Update extension in DB if changed
          if (finalPath !== origPath) {
            db.prepare('UPDATE jobs SET file_path = ?, file_name = ? WHERE id = ?')
              .run(finalPath, path.basename(finalPath), req.params.jobId);
          }
          db.prepare('UPDATE jobs SET status = ?, phase = NULL, progress = 100, size_before = ?, size_after = ?, avg_fps = ?, elapsed_seconds = ?, completed_at = ?, updated_at = ? WHERE id = ?')
            .run('complete', sizeBefore, sizeAfter, jobMeta?.fps ?? null, elapsed, now, now, req.params.jobId);
          db.prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(job.worker_id);
          // Persist fingerprint so "Clear All" doesn't re-queue this file
          if (jobMeta) recordProcessedFile(jobMeta.file_path, sizeBefore, jobMeta.recipe, jobMeta.content_key ?? undefined);
          db.exec('COMMIT');
        } catch (txErr) {
          db.exec('ROLLBACK');
          throw txErr;
        }
        recordJobEvent(req.params.jobId, 'complete', job.worker_id ? (getDb().prepare('SELECT name FROM workers WHERE id=?').get(job.worker_id) as any)?.name : undefined, { sizeBefore, sizeAfter });
        broadcast('job:complete', { jobId: req.params.jobId, sizeBefore, sizeAfter, fileName: wirelessName });
        broadcast('stats:update', getStats());
        fireWebhooks('job:complete', { jobId: req.params.jobId, fileName: wirelessName ?? '', sizeBefore, sizeAfter });
        // Trigger next job immediately
        dispatchNext().catch(() => {});

        return { ok: true };
      } catch (err: any) {
        // Clean up tmp if it exists
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /**/ }
        const now = Math.floor(Date.now() / 1000);
        db.prepare('UPDATE jobs SET status = ?, phase = NULL, error = ?, updated_at = ? WHERE id = ?')
          .run('failed', err.message, now, req.params.jobId);
        db.prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(job.worker_id);
        recordJobEvent(req.params.jobId, 'failed', undefined, { error: err.message });
        broadcast('job:failed', { jobId: req.params.jobId, error: err.message });
        broadcast('stats:update', getStats());
        fireWebhooks('job:failed', { jobId: req.params.jobId, error: err.message });
        // Trigger next job even on failure (worker is now idle)
        dispatchNext().catch(() => {});
        return reply.status(500).send({ error: err.message });
      }
    },
  );
}

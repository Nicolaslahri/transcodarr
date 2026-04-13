import type { FastifyInstance } from 'fastify';
import { getJobs, getJob, enqueueFile, updateJobStatus, getStats, deleteJob, clearQueue } from '../queue.js';
import { broadcast } from '../server.js';
import { dispatchNext } from '../dispatcher.js';

export async function jobsRoutes(app: FastifyInstance) {
  // GET /api/jobs
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/', async (req) => {
    const limit  = Math.min(parseInt(req.query.limit ?? '50'), 200);
    const offset = parseInt(req.query.offset ?? '0');
    return getJobs(limit, offset);
  });

  // GET /api/jobs/stats
  app.get('/stats', async () => getStats());

  // GET /api/jobs/:id
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    return job;
  });

  // POST /api/jobs — manually enqueue a file
  app.post<{ Body: { filePath: string; recipe: string } }>('/', async (req, reply) => {
    const job = enqueueFile(req.body.filePath, req.body.recipe, true);
    if (!job) return reply.status(400).send({ error: 'Could not enqueue file (already queued, skipped, or unreadable)' });
    dispatchNext().catch(() => {});
    return job;
  });

  // DELETE /api/jobs — clear history (completed + failed + skipped only, never touches queued)
  app.delete('/', async () => {
    const count = clearQueue(['complete', 'failed', 'skipped']);
    broadcast('job:cleared', { count });
    broadcast('stats:update', getStats());
    return { ok: true, deleted: count };
  });

  // DELETE /api/jobs/:id — permanently remove a single job
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    if (['transcoding', 'dispatched', 'swapping'].includes(job.status)) {
      return reply.status(400).send({ error: 'Cannot remove an in-progress job' });
    }
    deleteJob(req.params.id);
    broadcast('job:removed', { id: req.params.id });
    broadcast('stats:update', getStats());
    return { ok: true };
  });

  // POST /api/jobs/:id/retry — retry a single failed job
  app.post<{ Params: { id: string } }>('/:id/retry', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    if (job.status !== 'failed') return reply.status(400).send({ error: 'Only failed jobs can be retried' });
    updateJobStatus(req.params.id, 'queued', { error: null, progress: 0, worker_id: null });
    dispatchNext().catch(() => {});
    return getJob(req.params.id);
  });

  // POST /api/jobs/retry-all — retry all failed jobs at once
  app.post('/retry-all', async () => {
    const { getDb } = await import('../db.js');
    const failedIds = (getDb().prepare("SELECT id FROM jobs WHERE status = 'failed'").all() as any[]).map(r => r.id);
    for (const id of failedIds) {
      updateJobStatus(id, 'queued', { error: null, progress: 0, worker_id: null });
    }
    dispatchNext().catch(() => {});
    broadcast('stats:update', getStats());
    return { ok: true, retried: failedIds.length };
  });
}

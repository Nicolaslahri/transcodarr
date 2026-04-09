import type { FastifyInstance } from 'fastify';
import { getJobs, getJob, enqueueFile, updateJobStatus, getStats, deleteJob, clearQueue } from '../queue.js';
import { broadcast } from '../server.js';

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
    const job = enqueueFile(req.body.filePath, req.body.recipe);
    if (!job) return reply.status(400).send({ error: 'Could not enqueue file (already queued, skipped, or unreadable)' });
    return job;
  });

  // DELETE /api/jobs — clear all non-active jobs
  app.delete('/', async () => {
    const count = clearQueue();
    broadcast('job:cleared', { count });
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
    return { ok: true };
  });

  // POST /api/jobs/:id/retry — retry a failed job
  app.post<{ Params: { id: string } }>('/:id/retry', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ error: 'Not found' });
    if (job.status !== 'failed') return reply.status(400).send({ error: 'Only failed jobs can be retried' });
    updateJobStatus(req.params.id, 'queued', { error: null, progress: 0, worker_id: null });
    return getJob(req.params.id);
  });
}

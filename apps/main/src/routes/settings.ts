import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import { nanoid } from 'nanoid';
import { BUILT_IN_RECIPES } from '@transcodarr/shared';

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/settings/recipes — list all recipes
  app.get('/recipes', async () => BUILT_IN_RECIPES);

  // GET /api/settings/paths — list watched paths
  app.get('/paths', async () => {
    return getDb().prepare('SELECT * FROM watched_paths ORDER BY created_at DESC').all();
  });

  // POST /api/settings/paths — add a watched path
  app.post<{ Body: { path: string; recipe: string } }>('/paths', async (req, reply) => {
    const { path: watchPath, recipe } = req.body;
    if (!watchPath || !recipe) return reply.status(400).send({ error: 'path and recipe required' });

    const id = nanoid();
    getDb().prepare('INSERT INTO watched_paths (id, path, recipe) VALUES (?, ?, ?)')
      .run(id, watchPath, recipe);
    return { id, path: watchPath, recipe, enabled: 1, createdAt: Math.floor(Date.now() / 1000) };
  });

  // DELETE /api/settings/paths/:id — remove a watched path
  app.delete<{ Params: { id: string } }>('/paths/:id', async (req) => {
    getDb().prepare('DELETE FROM watched_paths WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // PUT /api/settings/paths/:id/toggle — enable/disable a watched path
  app.put<{ Params: { id: string }; Body: { enabled: boolean } }>('/paths/:id/toggle', async (req) => {
    getDb().prepare('UPDATE watched_paths SET enabled = ? WHERE id = ?')
      .run(req.body.enabled ? 1 : 0, req.params.id);
    return { ok: true };
  });

  // GET /api/settings/general — key/value settings
  app.get('/general', async () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  });

  // PUT /api/settings/general — update key/value settings
  app.put<{ Body: Record<string, string> }>('/general', async (req) => {
    const stmt = getDb().prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [key, value] of Object.entries(req.body)) {
      stmt.run(key, value);
    }
    return { ok: true };
  });
}

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import { nanoid } from 'nanoid';
import { BUILT_IN_RECIPES } from '@transcodarr/shared';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function settingsRoutes(app: FastifyInstance) {
  // ─── Recipes ────────────────────────────────────────────────────────────────
  app.get('/recipes', async () => BUILT_IN_RECIPES);

  app.get('/fs', async (req) => {
    const q = req.query as { path?: string };
    const isWindows = os.platform() === 'win32';

    // On Windows with no path: enumerate drive letters first
    if (!q.path && isWindows) {
      const drives: { name: string; path: string }[] = [];
      for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) {
        const root = `${letter}:\\`;
        try { if (fs.existsSync(root)) drives.push({ name: root, path: root }); } catch { /**/ }
      }
      return { current: '', parent: '', dirs: drives };
    }

    // Default root: / on Linux, C:\ on Windows
    const defaultRoot = isWindows ? 'C:\\' : '/';
    let target = q.path ? path.resolve(q.path) : defaultRoot;
    if (!fs.existsSync(target)) target = defaultRoot;

    try {
      const dirents = fs.readdirSync(target, { withFileTypes: true });
      const dirs = dirents
        .filter(d => {
          if (!d.isDirectory()) return false;
          // On Linux, skip proc/sys/dev virtual filesystems but keep /mnt and /media
          if (!isWindows) {
            const skip = ['proc', 'sys', 'dev', 'run', 'snap', 'lost+found'];
            if (skip.includes(d.name)) return false;
          }
          return true;
        })
        .map(d => ({ name: d.name, path: path.join(target, d.name) }));
      return { current: target, parent: path.dirname(target), dirs };
    } catch {
      return { current: target, parent: path.dirname(target), dirs: [] };
    }
  });

  // ─── Watched Paths ───────────────────────────────────────────────────────────
  app.get('/paths', async () => {
    return getDb().prepare('SELECT * FROM watched_paths ORDER BY created_at DESC').all();
  });

  app.post<{ Body: {
    path: string; recipe: string;
    recurse?: boolean; extensions?: string;
    priority?: string; minSizeMb?: number;
  } }>('/paths', async (req, reply) => {
    const { path: watchPath, recipe, recurse = true, extensions = '.mkv,.mp4,.avi,.ts,.mov', priority = 'normal', minSizeMb = 100 } = req.body;
    if (!watchPath || !recipe) return reply.status(400).send({ error: 'path and recipe required' });

    const id = nanoid();
    getDb().prepare(`
      INSERT INTO watched_paths (id, path, recipe, recurse, extensions, priority, min_size_mb)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, watchPath, recipe, recurse ? 1 : 0, extensions, priority, minSizeMb);
    return { id, path: watchPath, recipe, enabled: true, recurse, extensions, priority, minSizeMb, createdAt: Date.now() };
  });

  app.put<{ Params: { id: string }; Body: {
    path?: string; recipe?: string;
    recurse?: boolean; extensions?: string;
    priority?: string; minSizeMb?: number;
  } }>('/paths/:id', async (req) => {
    const { path: watchPath, recipe, recurse, extensions, priority, minSizeMb } = req.body;
    const fields: string[] = [];
    const vals: any[] = [];
    if (watchPath !== undefined) { fields.push('path = ?'); vals.push(watchPath); }
    if (recipe !== undefined) { fields.push('recipe = ?'); vals.push(recipe); }
    if (recurse !== undefined) { fields.push('recurse = ?'); vals.push(recurse ? 1 : 0); }
    if (extensions !== undefined) { fields.push('extensions = ?'); vals.push(extensions); }
    if (priority !== undefined) { fields.push('priority = ?'); vals.push(priority); }
    if (minSizeMb !== undefined) { fields.push('min_size_mb = ?'); vals.push(minSizeMb); }
    if (fields.length) {
      vals.push(req.params.id);
      getDb().prepare(`UPDATE watched_paths SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/paths/:id', async (req) => {
    getDb().prepare('DELETE FROM watched_paths WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  app.put<{ Params: { id: string }; Body: { enabled: boolean } }>('/paths/:id/toggle', async (req) => {
    getDb().prepare('UPDATE watched_paths SET enabled = ? WHERE id = ?')
      .run(req.body.enabled ? 1 : 0, req.params.id);
    return { ok: true };
  });

  // ─── General Settings (key-value) ────────────────────────────────────────────
  app.get('/general', async () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  });

  app.put<{ Body: Record<string, string> }>('/general', async (req) => {
    const stmt = getDb().prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [key, value] of Object.entries(req.body)) {
      stmt.run(key, value);
    }
    return { ok: true };
  });

  // ─── Reset Setup ─────────────────────────────────────────────────────────────
  // Deletes ~/.transcodarr/config.json and exits so the launcher re-runs onboarding
  app.post('/reset', async (req, reply) => {
    const configFile = path.join(os.homedir(), '.transcodarr', 'config.json');
    try {
      if (fs.existsSync(configFile)) fs.unlinkSync(configFile);
    } catch { /* ignore */ }
    reply.send({ ok: true });
    // Short delay so response is sent before process exits
    setTimeout(() => process.exit(0), 300);
  });

  // ─── Smart Filters ───────────────────────────────────────────────────────────
  // Filters are stored as JSON in settings table under key 'smart_filters'
  app.get('/filters', async () => {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'smart_filters'").get() as any;
    if (!row) return getDefaultFilters();
    try { return JSON.parse(row.value); } catch { return getDefaultFilters(); }
  });

  app.put<{ Body: SmartFilters }>('/filters', async (req) => {
    const db = getDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('smart_filters', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(req.body));
    return { ok: true };
  });
}

export interface SmartFilters {
  skipAlreadyTargetCodec: boolean;
  skipBelowBitrateKbps: number | null;
  skipBelowHeightPx: number | null;
  skipBelowSizeMb: number | null;
  skipKeywords: string[];
  skipDolbyAtmos: boolean;
}

function getDefaultFilters(): SmartFilters {
  return {
    skipAlreadyTargetCodec: true,
    skipBelowBitrateKbps: 500,
    skipBelowHeightPx: 480,
    skipBelowSizeMb: 50,
    skipKeywords: ['REMUX', 'BDREMUX'],
    skipDolbyAtmos: true,
  };
}

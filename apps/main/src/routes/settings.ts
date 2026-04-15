import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import { nanoid } from 'nanoid';
import { BUILT_IN_RECIPES } from '@transcodarr/shared';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { addWatchedPath, manualScanDirectory } from '../watcher.js';
import { fireWebhooks } from '../webhooks.js';

/**
 * Returns true for URLs that resolve to private/loopback/link-local addresses.
 * Used to block SSRF on recipe import and webhook delivery.
 */
function isPrivateUrl(urlStr: string): boolean {
  try {
    const { hostname, protocol } = new URL(urlStr);
    if (!['http:', 'https:'].includes(protocol)) return true; // block non-HTTP schemes
    const lower = hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]'].includes(lower)) return true;
    const parts = lower.split('.').map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      if (parts[0] === 10) return true;                                      // 10.x.x.x
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16-31.x.x
      if (parts[0] === 192 && parts[1] === 168) return true;                 // 192.168.x.x
      if (parts[0] === 169 && parts[1] === 254) return true;                 // link-local
    }
    return false;
  } catch { return true; } // unparseable URL treated as private
}

export async function settingsRoutes(app: FastifyInstance) {
  // ─── Recipes ────────────────────────────────────────────────────────────────
  const getCustomRecipes = () => {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'custom_recipes'").get() as any;
    if (!row) return [];
    try { return JSON.parse(row.value); } catch { return []; }
  };

  app.get('/recipes', async () => [...BUILT_IN_RECIPES, ...getCustomRecipes()]);

  // POST /api/settings/recipes/import — import community recipes from a URL
  app.post<{ Body: { url: string } }>('/recipes/import', async (req, reply) => {
    const { url } = req.body;
    if (!url) return reply.status(400).send({ error: 'url is required' });
    if (isPrivateUrl(url)) return reply.status(400).send({ error: 'URL must be a public internet address' });
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return reply.status(400).send({ error: `Fetch failed: ${res.status}` });
      const data = await res.json() as any[];
      if (!Array.isArray(data)) return reply.status(400).send({ error: 'Expected a JSON array of recipes' });

      // Basic schema validation — each item must have id, name, targetCodec
      const valid = data.filter(r => r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.targetCodec === 'string');
      if (valid.length === 0) return reply.status(400).send({ error: 'No valid recipes found in the response' });

      // Tag with sourceUrl, merge with existing custom recipes (deduplicate by id)
      const existing: any[] = getCustomRecipes();
      const tagged = valid.map(r => ({ ...r, sourceUrl: url, icon: r.icon ?? '🔧', color: r.color ?? '#6b7280' }));
      const merged = [...existing.filter(e => !tagged.find((t: any) => t.id === e.id)), ...tagged];

      getDb().prepare("INSERT INTO settings (key, value) VALUES ('custom_recipes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(merged));

      return { ok: true, imported: tagged.length };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message ?? 'Import failed' });
    }
  });

  // DELETE /api/settings/recipes/custom/:id — remove a custom recipe
  app.delete<{ Params: { id: string } }>('/recipes/custom/:id', async (req) => {
    const existing: any[] = getCustomRecipes();
    const filtered = existing.filter(r => r.id !== req.params.id);
    getDb().prepare("INSERT INTO settings (key, value) VALUES ('custom_recipes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(filtered));
    return { ok: true };
  });

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
    preferred_audio_lang?: string | null; preferred_subtitle_lang?: string | null;
    scan_interval_hours?: number; move_to?: string | null;
  } }>('/paths', async (req, reply) => {
    const { path: watchPath, recipe, recurse = true, extensions = '.mkv,.mp4,.avi,.ts,.mov', priority = 'normal', minSizeMb = 100, preferred_audio_lang, preferred_subtitle_lang, scan_interval_hours = 0, move_to } = req.body;
    if (!watchPath || !recipe) return reply.status(400).send({ error: 'path and recipe required' });

    const id = nanoid();
    getDb().prepare(`
      INSERT INTO watched_paths (id, path, recipe, recurse, extensions, priority, min_size_mb, preferred_audio_lang, preferred_subtitle_lang, scan_interval_hours, move_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, watchPath, recipe, recurse ? 1 : 0, extensions, priority, minSizeMb, preferred_audio_lang ?? null, preferred_subtitle_lang ?? null, scan_interval_hours, move_to ?? null);

    // Dynamically hot-reload the watcher
    addWatchedPath(watchPath, recipe);

    return { id, path: watchPath, recipe, enabled: true, recurse, extensions, priority, minSizeMb, createdAt: Date.now() };
  });

  // ─── Manual Scans ───────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/paths/:id/scan', async (req, reply) => {
    const row = getDb().prepare('SELECT path, recipe FROM watched_paths WHERE id = ?').get(req.params.id) as any;
    if (!row) return reply.status(404).send({ error: 'Path not found' });
    
    // Start asynchronous full directory scan
    manualScanDirectory(row.path, row.recipe);
    return { ok: true, queued: true };
  });

  app.put<{ Params: { id: string }; Body: {
    path?: string; recipe?: string;
    recurse?: boolean; extensions?: string;
    priority?: string; minSizeMb?: number;
    preferred_audio_lang?: string | null; preferred_subtitle_lang?: string | null;
    scan_interval_hours?: number; move_to?: string | null;
  } }>('/paths/:id', async (req) => {
    const { path: watchPath, recipe, recurse, extensions, priority, minSizeMb, preferred_audio_lang, preferred_subtitle_lang, scan_interval_hours, move_to } = req.body;
    const fields: string[] = [];
    const vals: any[] = [];
    if (watchPath !== undefined) { fields.push('path = ?'); vals.push(watchPath); }
    if (recipe !== undefined) { fields.push('recipe = ?'); vals.push(recipe); }
    if (recurse !== undefined) { fields.push('recurse = ?'); vals.push(recurse ? 1 : 0); }
    if (extensions !== undefined) { fields.push('extensions = ?'); vals.push(extensions); }
    if (priority !== undefined) { fields.push('priority = ?'); vals.push(priority); }
    if (minSizeMb !== undefined) { fields.push('min_size_mb = ?'); vals.push(minSizeMb); }
    if (preferred_audio_lang !== undefined) { fields.push('preferred_audio_lang = ?'); vals.push(preferred_audio_lang); }
    if (preferred_subtitle_lang !== undefined) { fields.push('preferred_subtitle_lang = ?'); vals.push(preferred_subtitle_lang); }
    if (scan_interval_hours !== undefined) { fields.push('scan_interval_hours = ?'); vals.push(scan_interval_hours); }
    if (move_to !== undefined) { fields.push('move_to = ?'); vals.push(move_to ?? null); }
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
  // Writes a flag file that start.mjs polls for — avoids turbo dev auto-restart issues.
  // start.mjs kills the turbo child and relaunches in setup mode when it sees the flag.
  app.post('/reset', async (req, reply) => {
    const dir        = path.join(os.homedir(), '.transcodarr');
    const configFile = path.join(dir, 'config.json');
    const resetFlag  = path.join(dir, 'reset.flag');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    try { fs.writeFileSync(resetFlag, '1'); } catch {}
    try { if (fs.existsSync(configFile)) fs.unlinkSync(configFile); } catch {}
    return reply.send({ ok: true });
  });

  // ─── Webhooks ────────────────────────────────────────────────────────────────
  app.get('/webhooks', async () => {
    return getDb().prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
  });

  app.post<{ Body: { url: string; events?: string[]; secret?: string } }>('/webhooks', async (req, reply) => {
    const { url, events = ['job:complete', 'job:failed'], secret } = req.body;
    if (!url) return reply.status(400).send({ error: 'url is required' });
    if (isPrivateUrl(url)) return reply.status(400).send({ error: 'Webhook URL must be a public internet address' });
    const id = nanoid();
    getDb().prepare('INSERT INTO webhooks (id, url, events, secret) VALUES (?,?,?,?)').run(id, url, JSON.stringify(events), secret ?? null);
    return getDb().prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
  });

  app.put<{ Params: { id: string }; Body: { url?: string; events?: string[]; secret?: string; enabled?: boolean } }>('/webhooks/:id', async (req, reply) => {
    const { url, events, secret, enabled } = req.body;
    if (url !== undefined && isPrivateUrl(url)) return reply.status(400).send({ error: 'Webhook URL must be a public internet address' });
    const fields: string[] = [];
    const vals: any[] = [];
    if (url !== undefined) { fields.push('url = ?'); vals.push(url); }
    if (events !== undefined) { fields.push('events = ?'); vals.push(JSON.stringify(events)); }
    if (secret !== undefined) { fields.push('secret = ?'); vals.push(secret); }
    if (enabled !== undefined) { fields.push('enabled = ?'); vals.push(enabled ? 1 : 0); }
    if (!fields.length) return reply.status(400).send({ error: 'No fields to update' });
    vals.push(req.params.id);
    getDb().prepare(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/webhooks/:id', async (req) => {
    getDb().prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/webhooks/:id/test', async (req, reply) => {
    const hook = getDb().prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id) as any;
    if (!hook) return reply.status(404).send({ error: 'Not found' });
    await fireWebhooks('test', { message: 'Test webhook from Transcodarr', timestamp: Date.now() });
    return { ok: true };
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

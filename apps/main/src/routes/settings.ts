import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import { nanoid } from 'nanoid';
import { BUILT_IN_RECIPES, FfmpegArgsSchema, RecipeSchema } from '@transcodarr/shared';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { addWatchedPath, removeWatchedPath, manualScanDirectory, cancelScan } from '../watcher.js';
import { invalidateSettingsCache } from '../settings-cache.js';
import { fireWebhooks } from '../webhooks.js';
import { isPrivateUrl } from '../ssrf.js';

// Set of built-in recipe IDs — used to reject custom-recipe creation/import that
// would otherwise shadow built-ins. Lookups happen often; precompute once.
const BUILT_IN_RECIPE_IDS = new Set(BUILT_IN_RECIPES.map(r => r.id));

// Body schema for POST /recipes/custom — validates name, codec, container, AND
// runs ffmpegArgs through the shared denylist (concat:/file:/movie=/...).
//
// `ffmpegArgs` MUST be non-empty: a custom recipe with no args produces no
// output and fails every job silently. The base FfmpegArgsSchema allows
// `[]` for compatibility with built-in recipes that have no args (they use
// the recipes.ts switch instead) — we tighten the rule here for customs.
const CustomRecipeCreateSchema = z.object({
  name:            z.string().min(1).max(80),
  description:     z.string().max(500).optional().default(''),
  ffmpegArgs:      FfmpegArgsSchema.refine(a => a.length > 0, {
    message: 'Custom recipes must have at least one ffmpeg argument.',
  }),
  // Restricted to the known set so a typo can't poison `shouldSkipFile`'s
  // substring matcher. Mirrors the constraint in shared/schemas.ts RecipeSchema.
  targetCodec:     z.enum(['hevc', 'h265', 'h264', 'av1', 'copy', 'vp9']),
  targetContainer: z.enum(['mkv', 'mp4']).optional().default('mkv'),
  icon:            z.string().max(8).optional().default('🔧'),
  color:           z.string().max(20).optional().default('#6b7280'),
});

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

      // Strict schema validation per item — also runs ffmpegArgs through the denylist
      // (concat:/subfile:/file:/movie=/-f lavfi/...). Items that fail validation are
      // dropped silently and counted as `rejected` so the user knows.
      //
      // We also REQUIRE non-empty ffmpegArgs for community-imported recipes:
      // a community recipe with no args won't match any built-in switch case
      // in `buildFfmpegArgs`, so the worker would run ffmpeg with no recipe
      // args and silently produce a stream-copy. Rejecting at import keeps
      // import semantics consistent with `CustomRecipeCreateSchema`.
      const valid: any[] = [];
      const rejected: { idx: number; reason: string }[] = [];
      for (let i = 0; i < data.length; i++) {
        const candidate = { icon: '🔧', color: '#6b7280', description: '', ...data[i] };
        const parsed = RecipeSchema.safeParse(candidate);
        if (!parsed.success) {
          rejected.push({ idx: i, reason: parsed.error.errors[0]?.message ?? 'invalid' });
          continue;
        }
        if (BUILT_IN_RECIPE_IDS.has(parsed.data.id)) {
          rejected.push({ idx: i, reason: `id "${parsed.data.id}" collides with a built-in recipe` });
          continue;
        }
        if (!parsed.data.ffmpegArgs || parsed.data.ffmpegArgs.length === 0) {
          rejected.push({ idx: i, reason: `recipe "${parsed.data.id}" has no ffmpegArgs — community recipes must define their own ffmpeg arguments` });
          continue;
        }
        valid.push(parsed.data);
      }
      if (valid.length === 0) {
        return reply.status(400).send({ error: 'No valid recipes found', rejected });
      }

      // Tag with sourceUrl, merge with existing custom recipes (deduplicate by id)
      const existing: any[] = getCustomRecipes();
      const tagged = valid.map(r => ({ ...r, sourceUrl: url }));
      const merged = [...existing.filter(e => !tagged.find((t: any) => t.id === e.id)), ...tagged];

      getDb().prepare("INSERT INTO settings (key, value) VALUES ('custom_recipes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(merged));

      return { ok: true, imported: tagged.length, rejected: rejected.length, rejectedDetails: rejected };
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

  // GET /api/settings/recipes/stats — per-recipe avg fps from completed jobs
  app.get('/recipes/stats', async () => {
    const rows = getDb().prepare(`
      SELECT recipe, COUNT(*) as job_count, AVG(avg_fps) as avg_fps
      FROM jobs WHERE status = 'complete' AND avg_fps IS NOT NULL AND avg_fps > 0
      GROUP BY recipe
    `).all() as any[];
    return Object.fromEntries(rows.map((r: any) => [r.recipe, { avgFps: Math.round(r.avg_fps), jobCount: r.job_count }]));
  });

  // POST /api/settings/recipes/custom — create a custom recipe from scratch.
  // Body is validated by CustomRecipeCreateSchema which runs ffmpegArgs through
  // the same denylist used for imports + the worker-side sanitiser (defence in depth).
  app.post('/recipes/custom', async (req, reply) => {
    const parsed = CustomRecipeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid recipe',
        details: parsed.error.flatten(),
      });
    }
    const { name, description, ffmpegArgs, targetCodec, targetContainer, icon, color } = parsed.data;
    const id = `custom-${nanoid(8)}`;

    // Defensive: id collision with a built-in recipe is impossible because
    // built-in ids don't start with "custom-", but reject explicitly anyway.
    if (BUILT_IN_RECIPE_IDS.has(id)) {
      return reply.status(409).send({ error: `Generated id "${id}" collides with a built-in recipe — try again` });
    }

    const existing: any[] = getCustomRecipes();
    const newRecipe = { id, name, description, ffmpegArgs, targetCodec, targetContainer, icon, color };
    existing.push(newRecipe);
    getDb().prepare("INSERT INTO settings (key, value) VALUES ('custom_recipes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(existing));
    return newRecipe;
  });

  // POST /api/settings/fs/mkdir — create a new directory on the server filesystem
  app.post<{ Body: { path: string } }>('/fs/mkdir', async (req, reply) => {
    const { path: dirPath } = req.body;
    if (!dirPath) return reply.status(400).send({ error: 'path required' });
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return { ok: true, path: dirPath };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
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

  app.get<{ Params: { id: string } }>('/paths/:id/stats', async (req, reply) => {
    const path_row = getDb().prepare('SELECT * FROM watched_paths WHERE id = ?').get(req.params.id) as any;
    if (!path_row) return reply.status(404).send({ error: 'Not found' });
    const watchPath = path_row.path;
    const pattern = watchPath.endsWith('/') || watchPath.endsWith('\\') ? `${watchPath}%` : `${watchPath}/%`;

    const counts = getDb().prepare(`
      SELECT status, COUNT(*) as cnt, SUM(size_before) as sb, SUM(size_after) as sa
      FROM jobs
      WHERE file_path LIKE ?
      GROUP BY status
    `).all(pattern) as any[];

    let queued = 0, active = 0, complete = 0, failed = 0, skipped = 0;
    let sizeBefore = 0, sizeAfter = 0;
    const activeStatuses = new Set(['dispatched','transcoding','receiving','sending','swapping','finalizing']);

    for (const row of counts) {
      const cnt = row.cnt as number;
      if (row.status === 'queued') queued += cnt;
      else if (activeStatuses.has(row.status)) active += cnt;
      else if (row.status === 'complete') {
        complete += cnt;
        sizeBefore += (row.sb ?? 0);
        sizeAfter  += (row.sa ?? 0);
      }
      else if (row.status === 'failed') failed += cnt;
      else if (row.status === 'skipped') skipped += cnt;
    }

    const total = queued + active + complete + failed + skipped;
    const gbSaved = sizeBefore > 0 ? ((sizeBefore - sizeAfter) / 1e9) : 0;

    return { total, queued, active, complete, failed, skipped, sizeBefore, sizeAfter, gbSaved };
  });

  app.post<{ Body: {
    path: string; recipe: string;
    recurse?: boolean; extensions?: string;
    priority?: string; minSizeMb?: number;
    preferred_audio_lang?: string | null; preferred_subtitle_lang?: string | null;
    scan_interval_hours?: number; move_to?: string | null;
    exclude_patterns?: string | null;
  } }>('/paths', async (req, reply) => {
    const { path: watchPath, recipe, recurse = true, extensions = '.mkv,.mp4,.avi,.ts,.mov', priority = 'normal', minSizeMb = 100, preferred_audio_lang, preferred_subtitle_lang, scan_interval_hours = 0, move_to, exclude_patterns } = req.body;
    if (!watchPath || !recipe) return reply.status(400).send({ error: 'path and recipe required' });

    const id = nanoid();
    getDb().prepare(`
      INSERT INTO watched_paths (id, path, recipe, recurse, extensions, priority, min_size_mb, preferred_audio_lang, preferred_subtitle_lang, scan_interval_hours, move_to, exclude_patterns)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, watchPath, recipe, recurse ? 1 : 0, extensions, priority, minSizeMb, preferred_audio_lang ?? null, preferred_subtitle_lang ?? null, scan_interval_hours, move_to ?? null, exclude_patterns ?? null);

    // Dynamically hot-reload the watcher
    addWatchedPath(watchPath, recipe);

    return { id, path: watchPath, recipe, enabled: true, recurse, extensions, priority, minSizeMb, createdAt: Date.now() };
  });

  // ─── Manual Scans ───────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/paths/:id/scan', async (req, reply) => {
    const row = getDb().prepare('SELECT path, recipe, exclude_patterns FROM watched_paths WHERE id = ?').get(req.params.id) as any;
    if (!row) return reply.status(404).send({ error: 'Path not found' });
    // Start asynchronous full directory scan
    manualScanDirectory(row.path, row.recipe);
    return { ok: true, queued: true };
  });

  // POST /api/settings/paths/:id/scan/dry — preview what would be queued without actually queuing
  app.post<{ Params: { id: string } }>('/paths/:id/scan/dry', async (req, reply) => {
    const pathRow = getDb().prepare('SELECT path, recipe FROM watched_paths WHERE id = ?').get(req.params.id) as any;
    if (!pathRow) return reply.status(404).send({ error: 'Not found' });
    const dir = pathRow.path;
    if (!fs.existsSync(dir)) return reply.status(400).send({ error: 'Directory not found' });

    const SUPPORTED = ['.mkv', '.mp4', '.avi', '.mov', '.ts', '.m2ts', '.wmv'];
    const results = { total: 0, wouldQueue: 0, alreadyProcessed: 0, alreadyActive: 0 };

    const scan = (current: string) => {
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const e of entries) {
          const fp = path.join(current, e.name);
          if (e.isDirectory()) { scan(fp); continue; }
          if (!e.isFile()) continue;
          const ext = path.extname(fp).toLowerCase();
          if (!SUPPORTED.includes(ext)) continue;
          results.total++;
          const processed = getDb().prepare('SELECT 1 FROM processed_files WHERE file_path = ? AND recipe = ?').get(fp, pathRow.recipe);
          if (processed) { results.alreadyProcessed++; continue; }
          const active = getDb().prepare("SELECT status FROM jobs WHERE file_path = ?").get(fp) as any;
          if (active && ['transcoding','dispatched','swapping','receiving','sending','queued'].includes(active.status)) {
            results.alreadyActive++; continue;
          }
          results.wouldQueue++;
        }
      } catch { /* permission error or broken symlink — skip */ }
    };
    scan(dir);
    return results;
  });

  app.put<{ Params: { id: string }; Body: {
    path?: string; recipe?: string;
    recurse?: boolean; extensions?: string;
    priority?: string; minSizeMb?: number;
    preferred_audio_lang?: string | null; preferred_subtitle_lang?: string | null;
    scan_interval_hours?: number; move_to?: string | null;
    exclude_patterns?: string | null;
  } }>('/paths/:id', async (req) => {
    const { path: watchPath, recipe, recurse, extensions, priority, minSizeMb, preferred_audio_lang, preferred_subtitle_lang, scan_interval_hours, move_to, exclude_patterns } = req.body;
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
    if (exclude_patterns !== undefined) { fields.push('exclude_patterns = ?'); vals.push(exclude_patterns); }
    if (fields.length) {
      vals.push(req.params.id);
      getDb().prepare(`UPDATE watched_paths SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/paths/:id', async (req) => {
    // Cancel any in-progress scan for this path before removing it
    const row = getDb().prepare('SELECT path FROM watched_paths WHERE id = ?').get(req.params.id) as any;
    if (row?.path) {
      cancelScan(row.path);
      // Drop the path from the live watcher's in-memory state — without this,
      // newly-added files under the deleted path would still enqueue jobs.
      removeWatchedPath(row.path);
    }
    getDb().prepare('DELETE FROM watched_paths WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  app.put<{ Params: { id: string }; Body: { enabled: boolean } }>('/paths/:id/toggle', async (req) => {
    const row = getDb().prepare('SELECT path, recipe FROM watched_paths WHERE id = ?').get(req.params.id) as any;
    getDb().prepare('UPDATE watched_paths SET enabled = ? WHERE id = ?')
      .run(req.body.enabled ? 1 : 0, req.params.id);
    // Sync the live watcher: stop watching when disabled, re-add when re-enabled.
    if (row?.path) {
      if (req.body.enabled) {
        addWatchedPath(row.path, row.recipe, false);
      } else {
        removeWatchedPath(row.path);
      }
    }
    return { ok: true };
  });

  // ─── General Settings (key-value) ────────────────────────────────────────────
  const PORT_FILE = path.join(os.homedir(), '.transcodarr', 'port');

  app.get('/general', async () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out = Object.fromEntries(rows.map(r => [r.key, r.value])) as Record<string, string>;
    // Expose persisted port so the UI can show it (stored in a file separate from DB)
    try { out.port = fs.readFileSync(PORT_FILE, 'utf-8').trim(); } catch { /* not yet saved */ }
    return out;
  });

  app.put<{ Body: Record<string, string> }>('/general', async (req) => {
    const { port: portStr, ...rest } = req.body;
    // Port lives in its own file (survives config.json resets) — not in the DB
    if (portStr !== undefined) {
      const p = parseInt(portStr, 10);
      if (!isNaN(p) && p >= 1 && p <= 65535) {
        try { fs.mkdirSync(path.dirname(PORT_FILE), { recursive: true }); } catch {}
        fs.writeFileSync(PORT_FILE, String(p));
      }
    }
    const stmt = getDb().prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [key, value] of Object.entries(rest)) {
      stmt.run(key, value);
    }
    invalidateSettingsCache(); // bust cache so next dispatch reads fresh values
    return { ok: true };
  });

  // ─── Reset Setup ─────────────────────────────────────────────────────────────
  // Writes a flag file that start.mjs polls for — avoids turbo dev auto-restart issues.
  // start.mjs kills the turbo child and relaunches in setup mode when it sees the flag.
  app.post('/reset', async (req, reply) => {
    const dir        = path.join(os.homedir(), '.transcodarr');
    const configFile = path.join(dir, 'config.json');
    const portFile   = path.join(os.homedir(), '.transcodarr', 'port');
    const resetFlag  = path.join(dir, 'reset.flag');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    // Persist current port so setup comes back on the same URL after reset.
    const currentPort = process.env.PORT ?? process.env.MAIN_PORT;
    if (currentPort) {
      try { fs.writeFileSync(portFile, currentPort); } catch {}
    }
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
    const { createHmac } = await import('crypto');
    const hook = getDb().prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id) as any;
    if (!hook) return reply.status(404).send({ error: 'Not found' });
    const body = JSON.stringify({ event: 'test', data: { message: 'Test webhook from Transcodarr', timestamp: Date.now() }, timestamp: Date.now() });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (hook.secret) {
      const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
      headers['X-Transcodarr-Signature'] = `sha256=${sig}`;
    }
    const now = Math.floor(Date.now() / 1000);
    try {
      const res = await fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        getDb().prepare('UPDATE webhooks SET last_fired = ?, last_delivery_ok = 0 WHERE id = ?').run(now, hook.id);
        return reply.status(502).send({ error: `Remote returned HTTP ${res.status}` });
      }
      getDb().prepare('UPDATE webhooks SET last_fired = ?, last_delivery_ok = 1 WHERE id = ?').run(now, hook.id);
      return { ok: true, status: res.status };
    } catch (err: any) {
      getDb().prepare('UPDATE webhooks SET last_fired = ?, last_delivery_ok = 0 WHERE id = ?').run(now, hook.id);
      return reply.status(502).send({ error: err.message ?? 'Delivery failed — check the URL and try again' });
    }
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

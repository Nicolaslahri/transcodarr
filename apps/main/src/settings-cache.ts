/**
 * settings-cache.ts — lightweight read-through cache for the settings table.
 *
 * dispatchOne() previously made 6+ individual DB reads on every 30-second tick
 * and on every job:complete. This module batches them into a single SELECT and
 * caches the result until a settings write calls invalidateSettingsCache().
 */

import { getDb } from './db.js';

let cache: Record<string, string> | null = null;

/**
 * Return all settings as a flat key→value map.
 * Result is cached in-process; call invalidateSettingsCache() after any write.
 */
export function getAllSettings(): Record<string, string> {
  if (cache === null) {
    cache = Object.fromEntries(
      (getDb().prepare('SELECT key, value FROM settings').all() as any[])
        .map((r: any) => [r.key as string, r.value as string])
    );
  }
  return cache as Record<string, string>;
}

/** Bust the cache — must be called after every INSERT/UPDATE on the settings table. */
export function invalidateSettingsCache(): void {
  cache = null;
}

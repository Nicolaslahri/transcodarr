/**
 * mappers.ts — single source of truth for DB row → typed object conversions.
 *
 * Previously rowToWorker was copy-pasted into routes/workers.ts, dispatcher.ts,
 * and server.ts with slightly different field sets, causing silent schema drift.
 * Everything imports from here now.
 */

import { createRequire } from 'module';
import type { WorkerInfo, ConnectionMode } from '@transcodarr/shared';

const require = createRequire(import.meta.url);

/** Semver version of the Main node — read once at startup from package.json. */
export const MAIN_VERSION: string = (() => {
  try { return require('../../../package.json').version; } catch { return 'unknown'; }
})();

/** Convert a raw SQLite workers row to a fully-typed WorkerInfo. */
export function rowToWorker(row: any): WorkerInfo {
  const workerVersion   = row.version ?? undefined;
  const versionMismatch = workerVersion != null && workerVersion !== MAIN_VERSION;
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
    version:        workerVersion,
    versionMismatch,
  };
}

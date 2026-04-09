import { getDb } from './db.js';
import { getJobsByStatus, updateJobStatus, getJob } from './queue.js';
import { broadcast } from './server.js';
import type { WorkerInfo, JobPayload, SmbMapping } from '@transcodarr/shared';
import { BUILT_IN_RECIPES } from '@transcodarr/shared';
import { nanoid } from 'nanoid';
import path from 'path';

const DISPATCH_INTERVAL_MS = 5_000;

// ─── SMB path translation ─────────────────────────────────────────────────────

function translatePath(filePath: string, mappings: SmbMapping[]): string | undefined {
  for (const mapping of mappings) {
    // Normalize separators
    const base = mapping.networkBasePath.replace(/\\/g, '/').replace(/\/$/, '');
    const local = mapping.localBasePath.replace(/\\/g, path.sep);
    const normalized = filePath.replace(/\\/g, '/');

    if (normalized.startsWith(base)) {
      const relative = normalized.slice(base.length).replace(/\//g, path.sep);
      return path.join(local, relative);
    }
  }
  return undefined;
}

// ─── Worker registry ──────────────────────────────────────────────────────────

export function getWorkers(): WorkerInfo[] {
  return (getDb().prepare("SELECT * FROM workers WHERE status != 'offline'").all() as any[]).map(rowToWorker);
}

export function getAcceptedWorkers(): WorkerInfo[] {
  return (getDb().prepare("SELECT * FROM workers WHERE status IN ('active','idle')").all() as any[]).map(rowToWorker);
}

// ─── Dispatcher loop ──────────────────────────────────────────────────────────

export function startDispatcher(): void {
  setInterval(dispatchNext, DISPATCH_INTERVAL_MS);
  console.log(`  Dispatcher running (every ${DISPATCH_INTERVAL_MS / 1000}s)`);
}

async function dispatchNext(): Promise<void> {
  const queuedJobs = getJobsByStatus('queued');
  if (queuedJobs.length === 0) return;

  const workers = getAcceptedWorkers();
  const idleWorkers = workers.filter(w => w.status === 'idle');
  if (idleWorkers.length === 0) return;

  const job = queuedJobs[0];
  const worker = idleWorkers[0];
  const recipe = BUILT_IN_RECIPES.find(r => r.id === job.recipe);
  if (!recipe) return;

  const workerMappings: SmbMapping[] = JSON.parse(
    (getDb().prepare('SELECT smb_mappings FROM workers WHERE id = ?').get(worker.id) as any)?.smb_mappings ?? '[]'
  );

  const smbPath = translatePath(job.filePath, workerMappings);
  const callbackToken = nanoid(32);

  const payload: JobPayload = {
    jobId:         job.id,
    filePath:      job.filePath,
    smbPath,
    recipe,
    mainHost:      process.env.MAIN_HOST ?? '0.0.0.0',
    mainPort:      Number(process.env.MAIN_PORT ?? 3001),
    callbackToken,
  };

  try {
    const res = await fetch(`http://${worker.host}:${worker.port}/job`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`Worker returned ${res.status}`);

    updateJobStatus(job.id, 'dispatched', { worker_id: worker.id });
    getDb().prepare('UPDATE workers SET status = ? WHERE id = ?').run('active', worker.id);
    broadcast('job:progress', { ...getJob(job.id), workerName: worker.name });
    console.log(`📤 Dispatched "${job.fileName}" → ${worker.name}`);
  } catch (err: any) {
    console.error(`Failed to dispatch to ${worker.name}:`, err.message);
  }
}

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

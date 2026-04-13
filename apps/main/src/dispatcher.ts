import { getDb } from './db.js';
import { getJobsByStatus, updateJobStatus, getJob } from './queue.js';
import { broadcast } from './server.js';
import type { WorkerInfo, JobPayload, SmbMapping, ConnectionMode } from '@transcodarr/shared';
import { BUILT_IN_RECIPES } from '@transcodarr/shared';
import { nanoid } from 'nanoid';
import path from 'path';

const DISPATCH_INTERVAL_MS = 30_000; // Fallback heartbeat; actual dispatch is event-driven

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
  console.log(`  Dispatcher running (30s fallback heartbeat; event-driven on enqueue/complete)`);
}

// Exported so routes/jobs.ts, watcher.ts, and workers.ts can trigger dispatch immediately
export async function dispatchNext(): Promise<void> {
  const queuedJobs = getJobsByStatus('queued');
  if (queuedJobs.length === 0) return; // nothing to do, stay quiet

  const workers     = getAcceptedWorkers();
  const idleWorkers = workers.filter(w => w.status === 'idle');

  if (idleWorkers.length === 0) {
    const allWorkers = getDb().prepare('SELECT id, name, status FROM workers').all() as any[];
    if (allWorkers.length === 0) {
      console.log(`⏳ ${queuedJobs.length} job(s) queued — no workers registered yet`);
    } else {
      const summary = allWorkers.map(w => `${w.name}:${w.status}`).join(', ');
      console.log(`⏳ ${queuedJobs.length} job(s) queued — no idle workers (${summary})`);
    }
    return;
  }

  const job = queuedJobs[0];
  const worker = idleWorkers[0];
  const recipe = BUILT_IN_RECIPES.find(r => r.id === job.recipe);
  if (!recipe) return;

  const workerRow = getDb().prepare('SELECT smb_mappings, connection_mode FROM workers WHERE id = ?').get(worker.id) as any;
  const connectionMode: ConnectionMode = (workerRow?.connection_mode ?? 'smb') as ConnectionMode;
  const workerMappings: SmbMapping[] = JSON.parse(workerRow?.smb_mappings ?? '[]');

  const mainHost  = process.env.MAIN_HOST ?? '0.0.0.0';
  const mainPort  = Number(process.env.PORT ?? process.env.MAIN_PORT ?? 3001);
  const callbackToken = nanoid(32);

  let payload: JobPayload;

  if (connectionMode === 'wireless') {
    const baseUrl = `http://${mainHost}:${mainPort}`;
    payload = {
      jobId:         job.id,
      filePath:      job.filePath,
      recipe,
      mainHost,
      mainPort,
      callbackToken,
      transferMode:  'wireless',
      downloadUrl:   `${baseUrl}/api/workers/jobs/${job.id}/download`,
      uploadUrl:     `${baseUrl}/api/workers/jobs/${job.id}/upload`,
    };
    console.log(`📡 Wireless mode: worker will download/upload via ${baseUrl}`);
  } else {
    const smbPath = translatePath(job.filePath, workerMappings);
    payload = {
      jobId:        job.id,
      filePath:     job.filePath,
      smbPath,
      recipe,
      mainHost,
      mainPort,
      callbackToken,
      transferMode: 'smb',
    };
    if (smbPath) {
      console.log(`📂 SMB mode: ${job.filePath} → ${smbPath}`);
    } else {
      console.log(`⚠️  SMB mode but no path mapping for ${job.filePath} — worker will use filePath directly`);
    }
  }

  try {
    const workerUrl = `http://${worker.host}:${worker.port}/job`;
    console.log(`📤 Dispatching "${job.fileName}" → ${worker.name} (${workerUrl}) [${connectionMode}]`);

    const res = await fetch(workerUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Worker returned ${res.status}: ${text}`);
    }

    updateJobStatus(job.id, 'dispatched', { worker_id: worker.id, callback_token: callbackToken });
    getDb().prepare('UPDATE workers SET status = ? WHERE id = ?').run('active', worker.id);
    broadcast('job:progress', { ...getJob(job.id), workerName: worker.name });
    console.log(`✅ Dispatched successfully → ${worker.name}`);
  } catch (err: any) {
    console.error(`❌ Failed to dispatch to ${worker.name} (${worker.host}:${worker.port}):`, err.message);
  }
}

function rowToWorker(row: any): WorkerInfo {
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
  };
}

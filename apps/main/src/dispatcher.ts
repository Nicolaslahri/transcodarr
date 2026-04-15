import { getDb } from './db.js';
import { getJobsByStatus, updateJobStatus, getJob, recordJobEvent } from './queue.js';
import { broadcast } from './server.js';
import type { WorkerInfo, JobPayload, SmbMapping, ConnectionMode, LangPrefs } from '@transcodarr/shared';
import { BUILT_IN_RECIPES } from '@transcodarr/shared';
import { nanoid } from 'nanoid';
import path from 'path';
import os from 'os';

function getRoutableIp(preferSubnet?: string): string {
  const candidates: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const p = addr.address.split('.').map(Number);
      if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) continue; // Docker bridge range
      if (p[0] === 169 && p[1] === 254) continue;              // link-local
      candidates.push(addr.address);
    }
  }
  // Prefer an interface on the same /24 as the worker (most reliable for cross-device transfers)
  if (preferSubnet) {
    const prefix = preferSubnet.split('.').slice(0, 3).join('.');
    const match = candidates.find(ip => ip.startsWith(prefix + '.'));
    if (match) return match;
  }
  return candidates.find(ip => ip.startsWith('192.168.'))
    ?? candidates.find(ip => ip.startsWith('10.'))
    ?? candidates[0]
    ?? '127.0.0.1';
}

const DISPATCH_INTERVAL_MS = 30_000; // Fallback heartbeat; actual dispatch is event-driven

// ─── SMB path translation ─────────────────────────────────────────────────────

function translatePath(filePath: string, mappings: SmbMapping[]): { smbPath: string; smbBasePath: string } | undefined {
  for (const mapping of mappings) {
    // Normalize separators
    const base = mapping.networkBasePath.replace(/\\/g, '/').replace(/\/$/, '');
    const local = mapping.localBasePath.replace(/\\/g, path.sep);
    const normalized = filePath.replace(/\\/g, '/');

    if (normalized.startsWith(base)) {
      const relative = normalized.slice(base.length).replace(/\//g, path.sep);
      return { smbPath: path.join(local, relative), smbBasePath: local };
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

// Re-entrancy guard: prevents concurrent dispatchNext() calls from racing each other
let dispatching = false;

// Circuit breaker: track consecutive dispatch failures per worker
// After 3 failures, mark the worker offline until it re-registers
const workerFailCount = new Map<string, number>();

// Exported so routes/jobs.ts, watcher.ts, and workers.ts can trigger dispatch immediately.
// Loops until no more idle workers or no more queued jobs (handles max_concurrent_jobs).
export async function dispatchNext(): Promise<void> {
  if (dispatching) return; // already running — new jobs will be picked up by the ongoing loop
  dispatching = true;
  try {
    // Loop until no more idle workers or no more queued jobs
    while (true) {
      const dispatched = await dispatchOne();
      if (!dispatched) break;
    }
  } finally {
    dispatching = false;
  }
}

// Dispatch a single job-worker pair. Returns true if a job was dispatched, false if nothing to do.
async function dispatchOne(): Promise<boolean> {
  const queuedJobs = getJobsByStatus('queued');
  if (queuedJobs.length === 0) return false;

  // Enforce max_concurrent_jobs setting.
  // The UI saves it as 'maxConcurrentJobs' (camelCase) — check both keys for back-compat.
  const maxRow = (
    getDb().prepare("SELECT value FROM settings WHERE key = 'max_concurrent_jobs'").get() ??
    getDb().prepare("SELECT value FROM settings WHERE key = 'maxConcurrentJobs'").get()
  ) as any;
  const maxConcurrent = maxRow ? parseInt(maxRow.value, 10) : 0;
  if (maxConcurrent > 0) {
    const activeCount = (getDb().prepare(
      "SELECT COUNT(*) as cnt FROM jobs WHERE status IN ('dispatched','transcoding','swapping','receiving','sending')"
    ).get() as any).cnt;
    if (activeCount >= maxConcurrent) {
      console.log(`⏳ Max concurrent jobs (${maxConcurrent}) reached — ${activeCount} active`);
      return false;
    }
  }

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
    return false;
  }

  // Find first dispatchable job+worker pair (respecting pinned_worker_id)
  let job = queuedJobs[0];
  let worker = idleWorkers[0];
  const pinned = queuedJobs.find(j => j.pinnedWorkerId && idleWorkers.some(w => w.id === j.pinnedWorkerId));
  const unpinned = queuedJobs.find(j => !j.pinnedWorkerId);
  if (pinned) {
    job = pinned;
    worker = idleWorkers.find(w => w.id === pinned.pinnedWorkerId)!;
  } else if (unpinned) {
    job = unpinned;
    worker = idleWorkers[0];
  } else {
    console.log(`⏳ ${queuedJobs.length} job(s) queued — pinned workers not idle yet`);
    return false;
  }

  const recipe = [...BUILT_IN_RECIPES, ...(() => {
    try {
      const row = getDb().prepare("SELECT value FROM settings WHERE key = 'custom_recipes'").get() as any;
      return row ? JSON.parse(row.value) : [];
    } catch { return []; }
  })()].find((r: any) => r.id === job.recipe);
  if (!recipe) return false;

  const workerRow = getDb().prepare('SELECT smb_mappings, connection_mode FROM workers WHERE id = ?').get(worker.id) as any;
  const connectionMode: ConnectionMode = (workerRow?.connection_mode ?? 'smb') as ConnectionMode;
  const workerMappings: SmbMapping[] = JSON.parse(workerRow?.smb_mappings ?? '[]');

  // Resolve language preferences: per-folder > global settings > none
  const langPrefs = (() => {
    const watchedPaths = getDb().prepare(
      'SELECT preferred_audio_lang, preferred_subtitle_lang FROM watched_paths WHERE enabled = 1 ORDER BY LENGTH(path) DESC'
    ).all() as any[];
    const matchingPath = watchedPaths.find(wp => job.filePath.startsWith(wp.path));
    const audioLang    = matchingPath?.preferred_audio_lang
      ?? (getDb().prepare("SELECT value FROM settings WHERE key = 'preferred_audio_lang'").get() as any)?.value
      ?? undefined;
    const subtitleLang = matchingPath?.preferred_subtitle_lang
      ?? (getDb().prepare("SELECT value FROM settings WHERE key = 'preferred_subtitle_lang'").get() as any)?.value
      ?? undefined;
    const prefs: LangPrefs = {};
    if (audioLang) prefs.audioLang = audioLang;
    if (subtitleLang) prefs.subtitleLang = subtitleLang;
    return Object.keys(prefs).length > 0 ? prefs : undefined;
  })();

  const rawHost   = process.env.MAIN_HOST ?? '0.0.0.0';
  const mainHost  = rawHost === '0.0.0.0' ? getRoutableIp(worker.host) : rawHost;
  const mainPort  = Number(process.env.PORT ?? process.env.MAIN_PORT ?? 3001);
  const callbackToken = nanoid(32);

  // Mark the worker as active in DB immediately before the async fetch,
  // so the next iteration of dispatchOne() doesn't try to use the same worker.
  getDb().prepare('UPDATE workers SET status = ? WHERE id = ?').run('active', worker.id);
  updateJobStatus(job.id, 'dispatched', { worker_id: worker.id, callback_token: callbackToken, dispatched_at: Math.floor(Date.now() / 1000) });

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
      langPrefs,
    };
    console.log(`📡 Wireless mode: worker will download/upload via ${baseUrl}`);
  } else {
    const translated = translatePath(job.filePath, workerMappings);
    payload = {
      jobId:        job.id,
      filePath:     job.filePath,
      smbPath:      translated?.smbPath,
      smbBasePath:  translated?.smbBasePath,
      recipe,
      mainHost,
      mainPort,
      callbackToken,
      transferMode: 'smb',
      langPrefs,
    };
    if (translated) {
      console.log(`📂 SMB mode: ${job.filePath} → ${translated.smbPath} (base: ${translated.smbBasePath})`);
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

    recordJobEvent(job.id, 'dispatched', worker.name);
    broadcast('job:progress', { ...getJob(job.id), workerName: worker.name });
    console.log(`✅ Dispatched successfully → ${worker.name}`);
    workerFailCount.delete(worker.id); // reset failure counter on success
    return true;
  } catch (err: any) {
    // Roll back the optimistic status update so the job re-queues on next dispatch attempt
    updateJobStatus(job.id, 'queued', { worker_id: null, callback_token: null, dispatched_at: null });
    getDb().prepare("UPDATE workers SET status = 'idle' WHERE id = ?").run(worker.id);
    console.error(`❌ Failed to dispatch to ${worker.name} (${worker.host}:${worker.port}):`, err.message);

    // Circuit breaker: mark worker offline after 3 consecutive failures
    const fails = (workerFailCount.get(worker.id) ?? 0) + 1;
    workerFailCount.set(worker.id, fails);
    if (fails >= 3) {
      getDb().prepare("UPDATE workers SET status = 'offline' WHERE id = ?").run(worker.id);
      broadcast('worker:offline', { id: worker.id, name: worker.name });
      workerFailCount.delete(worker.id);
      console.warn(`⚠️  Worker ${worker.name} marked offline after 3 consecutive dispatch failures`);
    }

    return false;
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

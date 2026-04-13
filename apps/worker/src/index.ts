import os from 'os';
import { nanoid } from 'nanoid';
import { ensureFfmpeg, detectHardware } from './hardware.js';
import { broadcastWorkerMdns, stopMdns } from './mdns.js';
import { createWorkerServer, initWorkerServer, startGpuStatsPoller, latestGpuStats } from './server.js';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const WORKER_VERSION: string = (() => {
  try { return require('../../package.json').version; } catch { return 'unknown'; }
})();

let config: any = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.transcodarr', 'config.json'), 'utf8'));
} catch { /**/ }

const WORKER_NAME = config.nodeName || process.env.WORKER_NAME || os.hostname();
const WORKER_PORT = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 3002);
const MAIN_URL    = config.mainUrl || process.env.MAIN_URL || 'http://localhost:3001';

const WORKER_ID = config.workerId || process.env.WORKER_ID || `worker-${nanoid(8)}`;

// Save the ID if it wasn't saved so it survives reboots
if (!config.workerId) {
  try {
    fs.writeFileSync(
      path.join(os.homedir(), '.transcodarr', 'config.json'),
      JSON.stringify({ ...config, workerId: WORKER_ID }, null, 2)
    );
  } catch { /**/ }
}

async function main() {
  console.log('⚡ Transcodarr Worker starting...');
  console.log(`   Name:      ${WORKER_NAME}`);
  console.log(`   ID:        ${WORKER_ID}`);
  console.log(`   Version:   v${WORKER_VERSION}`);
  console.log(`   Port:      ${WORKER_PORT}`);
  console.log(`   Dashboard: http://${getLocalIp()}:${WORKER_PORT}`);
  console.log(`   Main Node: ${MAIN_URL}\n`);

  // 0. Ensure ffmpeg is available (auto-downloads if missing)
  await ensureFfmpeg();

  // 1. Detect hardware
  const hardware = detectHardware();

  // 2. Start job server
  initWorkerServer(hardware, WORKER_ID, MAIN_URL);
  await createWorkerServer(WORKER_PORT);

  // 2b. Start GPU stats poller (NVIDIA only; no-ops silently on other hardware)
  startGpuStatsPoller();

  // 3. Register with Main (HTTP fallback if mDNS fails)
  try {
    await fetch(`${MAIN_URL}/api/workers/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: WORKER_ID, name: WORKER_NAME, host: getLocalIp(), port: WORKER_PORT, hardware, version: WORKER_VERSION }),
      signal:  AbortSignal.timeout(5000),
    });
    console.log('✅ Registered with Main via HTTP');
  } catch {
    console.log('⚠️  HTTP registration failed — will rely on mDNS discovery');
  }

  // 4. Broadcast mDNS beacon
  broadcastWorkerMdns(WORKER_ID, WORKER_NAME, WORKER_PORT, hardware);

  // 5. Heartbeat every 30s — includes GPU stats if available
  setInterval(async () => {
    try {
      const body: Record<string, unknown> = {};
      if (latestGpuStats) body.gpuStats = latestGpuStats;
      await fetch(`${MAIN_URL}/api/workers/${WORKER_ID}/heartbeat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(3000),
      });
    } catch { /* ignore */ }
  }, 30_000);

  console.log('\n🟢 Worker is ready and waiting for jobs.\n');
}

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

process.on('SIGINT', () => { stopMdns(); process.exit(0); });
process.on('SIGTERM', () => { stopMdns(); process.exit(0); });

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

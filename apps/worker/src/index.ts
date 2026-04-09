import os from 'os';
import { nanoid } from 'nanoid';
import { ensureFfmpeg, detectHardware } from './hardware.js';
import { broadcastWorkerMdns, stopMdns } from './mdns.js';
import { createWorkerServer, initWorkerServer } from './server.js';

const WORKER_NAME = process.env.WORKER_NAME ?? os.hostname();
const WORKER_PORT = Number(process.env.WORKER_PORT ?? 3001);
const MAIN_URL    = process.env.MAIN_URL ?? 'http://localhost:3001';

const WORKER_ID = process.env.WORKER_ID ?? `worker-${nanoid(8)}`;

async function main() {
  console.log('⚡ Transcodarr Worker starting...');
  console.log(`   Name: ${WORKER_NAME}`);
  console.log(`   ID:   ${WORKER_ID}`);
  console.log(`   Main: ${MAIN_URL}\n`);

  // 0. Ensure ffmpeg is available (auto-downloads if missing)
  await ensureFfmpeg();

  // 1. Detect hardware
  const hardware = detectHardware();

  // 2. Start job server
  initWorkerServer(hardware, WORKER_ID, MAIN_URL);
  await createWorkerServer(WORKER_PORT);

  // 3. Register with Main (HTTP fallback if mDNS fails)
  try {
    await fetch(`${MAIN_URL}/api/workers/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: WORKER_ID, name: WORKER_NAME, host: getLocalIp(), port: WORKER_PORT, hardware }),
      signal:  AbortSignal.timeout(5000),
    });
    console.log('✅ Registered with Main via HTTP');
  } catch {
    console.log('⚠️  HTTP registration failed — will rely on mDNS discovery');
  }

  // 4. Broadcast mDNS beacon
  broadcastWorkerMdns(WORKER_ID, WORKER_NAME, WORKER_PORT, hardware);

  // 5. Heartbeat every 30s
  setInterval(async () => {
    try {
      await fetch(`${MAIN_URL}/api/workers/${WORKER_ID}/heartbeat`, { method: 'POST', signal: AbortSignal.timeout(3000) });
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

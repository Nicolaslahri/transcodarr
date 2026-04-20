import { initDb } from './db.js';
import { createServer, startWorkerHealthPoller } from './server.js';
import { startWatcher, startPeriodicScanPoller } from './watcher.js';
import { startMdns } from './mdns.js';
import { ensureFfmpeg } from './ffmpeg.js';
import { startDispatcher } from './dispatcher.js';
import os from 'os';

const PORT = Number(process.env.PORT ?? process.env.MAIN_PORT ?? 3001);
const HOST = process.env.MAIN_HOST ?? '0.0.0.0';

async function main() {
  console.log('🚀 Transcodarr Main Node starting...');
  const isSetup = process.env.SETUP_MODE === '1';

  if (!isSetup) {
    // 1. Ensure ffprobe is available (auto-downloads if needed)
    await ensureFfmpeg();

    // 2. Init SQLite
    initDb();
    console.log('✅ Database ready');
  }

  // 2. Start Fastify server
  const app = await createServer(isSetup);
  await app.listen({ port: PORT, host: HOST });
  console.log(`✅ API server listening on http://${getLocalIp()}:${PORT}`);

  if (!isSetup) {
    // 3. Start file watcher
    startWatcher();
    console.log('✅ File watcher active');

    // 4. Advertise via mDNS
    startMdns(PORT);
    console.log('✅ mDNS listener active');

    // 5. Start worker health poller
    startWorkerHealthPoller();
    console.log('✅ Worker health poller active (20s interval)');

    // 6. Start job dispatcher
    // Only auto-detect if MAIN_HOST was not explicitly set (or was set to the bind-all sentinel)
    if (!process.env.MAIN_HOST || process.env.MAIN_HOST === '0.0.0.0') {
      process.env.MAIN_HOST = getLocalIp();
    }
    startDispatcher();
    console.log(`✅ Dispatcher started (callback: ${process.env.MAIN_HOST}:${PORT})`);

    // 7. Start periodic scan poller
    startPeriodicScanPoller();
  } else {
    console.log('✅ Setup mode active. Waiting for Configuration via UI.');
  }

  console.log('\n🎬 Transcodarr is ready. Open the UI to get started.\n');
}

function getLocalIp(): string {
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
  return candidates.find(ip => ip.startsWith('192.168.'))
    ?? candidates.find(ip => ip.startsWith('10.'))
    ?? candidates[0]
    ?? '127.0.0.1';
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

import { initDb } from './db.js';
import { createServer, startWorkerHealthPoller } from './server.js';
import { startWatcher } from './watcher.js';
import { startMdns } from './mdns.js';

const PORT = Number(process.env.MAIN_PORT ?? 3001);
const HOST = process.env.MAIN_HOST ?? '0.0.0.0';

async function main() {
  console.log('🚀 Transcodarr Main Node starting...');
  const isSetup = process.env.SETUP_MODE === '1';

  if (!isSetup) {
    // 1. Init SQLite
    initDb();
    console.log('✅ Database ready');
  }

  // 2. Start Fastify server
  const app = await createServer(isSetup);
  await app.listen({ port: PORT, host: HOST });
  console.log(`✅ API server listening on http://${HOST}:${PORT}`);

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
  } else {
    console.log('✅ Setup mode active. Waiting for Configuration via UI.');
  }

  console.log('\n🎬 Transcodarr is ready. Open the UI to get started.\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

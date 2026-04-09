import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WsEvent, WsEventType } from '@transcodarr/shared';

import { workersRoutes } from './routes/workers.js';
import { jobsRoutes } from './routes/jobs.js';
import { settingsRoutes } from './routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── WebSocket broadcast registry ─────────────────────────────────────────────

const clients = new Set<WebSocket>();

export function broadcast<T>(event: WsEventType, data: T): void {
  const payload = JSON.stringify({ event, data, timestamp: Date.now() } satisfies WsEvent<T>);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// ─── Server factory ───────────────────────────────────────────────────────────

export async function createServer() {
  const app = Fastify({ logger: { level: 'warn' } });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Serve built web UI
  const webOutPath = path.resolve(__dirname, '../../web/out');
  try {
    await app.register(fastifyStatic, { root: webOutPath, prefix: '/' });
  } catch {
    // Web UI not built yet — fine in dev
  }

  // WebSocket endpoint
  app.get('/ws', { websocket: true }, (connection, req) => {
    const ws = connection.socket;
    clients.add(ws);
    ws.send(JSON.stringify({ event: 'connected', timestamp: Date.now() }));
    ws.on('close', () => clients.delete(ws));
  });

  // API routes
  await app.register(workersRoutes, { prefix: '/api/workers' });
  await app.register(jobsRoutes,    { prefix: '/api/jobs' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  return app;
}

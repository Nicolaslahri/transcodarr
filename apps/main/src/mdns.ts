import { Bonjour } from 'bonjour-service';
import { getDb } from './db.js';
import { broadcast } from './server.js';
import { nanoid } from 'nanoid';
import type { HardwareProfile } from '@transcodarr/shared';

export function startMdns(mainPort: number): void {
  const bonjour = new Bonjour();

  // Advertise this Main node so Workers can find it
  bonjour.publish({
    name:   'Transcodarr Main',
    type:   'transcodarr-main',
    port:   mainPort,
    txt:    { version: '1.0.0' },
  });

  // Listen for Worker beacons
  const browser = bonjour.find({ type: 'transcodarr-worker' });

  browser.on('up', (service) => {
    const id        = service.txt?.['workerId'] as string ?? nanoid();
    const name      = service.name;
    const host      = service.addresses?.[0] ?? service.host;
    const port      = service.port;
    const hardware  = JSON.parse((service.txt?.['hardware'] as string) ?? '{}') as HardwareProfile;

    const db = getDb();
    const existing = db.prepare('SELECT id, status FROM workers WHERE id = ?').get(id) as any;

    if (!existing) {
      db.prepare(`
        INSERT INTO workers (id, name, host, port, status, hardware, last_seen)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `).run(id, name, host, port, JSON.stringify(hardware), Math.floor(Date.now() / 1000));

      console.log(`🔍 New worker discovered: ${name} (${host}:${port})`);
      broadcast('worker:discovered', { id, name, host, port, hardware, status: 'pending', smbMappings: [], lastSeen: Date.now() });
    } else {
      // Update last_seen and host/port (IP may change)
      db.prepare('UPDATE workers SET host = ?, port = ?, last_seen = ?, status = CASE WHEN status = ? THEN ? ELSE status END WHERE id = ?')
        .run(host, port, Math.floor(Date.now() / 1000), 'offline', 'idle', id);
    }
  });

  browser.on('down', (service) => {
    const id = service.txt?.['workerId'] as string;
    if (!id) return;
    getDb().prepare("UPDATE workers SET status = 'offline' WHERE id = ?").run(id);
    broadcast('worker:offline', { id });
    console.log(`❌ Worker offline: ${service.name}`);
  });
}

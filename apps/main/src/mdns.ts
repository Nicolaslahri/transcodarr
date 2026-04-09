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

      console.log(`🔍 New worker discovered via mDNS: ${name} (${host}:${port})`);
      broadcast('worker:discovered', { id, name, host, port, hardware, status: 'pending', smbMappings: [], lastSeen: Date.now() });
    } else {
      // Update host/port/last_seen.
      // If worker was previously accepted (idle/active), restore to idle.
      // If it was pending, keep it pending.
      // If it was offline after being accepted, bring it back as idle.
      const wasAccepted = ['idle', 'active', 'offline'].includes(existing.status);
      const newStatus   = wasAccepted ? 'idle' : existing.status;
      db.prepare('UPDATE workers SET host = ?, port = ?, hardware = ?, last_seen = ?, status = ? WHERE id = ?')
        .run(host, port, JSON.stringify(hardware), Math.floor(Date.now() / 1000), newStatus, id);

      if (wasAccepted) {
        console.log(`🔄 Worker reconnected: ${name} (${host}:${port})`);
        broadcast('worker:updated', { id, name, host, port, hardware, status: 'idle', smbMappings: [], lastSeen: Date.now() });
      }
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

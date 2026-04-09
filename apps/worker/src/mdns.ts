import { Bonjour } from 'bonjour-service';
import type { HardwareProfile } from '@transcodarr/shared';

let bonjourInstance: InstanceType<typeof Bonjour> | null = null;

export function broadcastWorkerMdns(workerId: string, workerName: string, port: number, hardware: HardwareProfile): void {
  bonjourInstance = new Bonjour();

  bonjourInstance.publish({
    name: workerName,
    type: 'transcodarr-worker',
    port,
    txt: {
      workerId,
      hardware: JSON.stringify(hardware),
    },
  });

  console.log(`📡 Broadcasting mDNS beacon: "${workerName}" on port ${port}`);
}

export function stopMdns(): void {
  bonjourInstance?.unpublishAll(() => bonjourInstance?.destroy());
}

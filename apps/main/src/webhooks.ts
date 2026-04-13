import { createHmac } from 'crypto';
import { getDb } from './db.js';

export async function fireWebhooks(event: string, data: unknown): Promise<void> {
  let hooks: any[];
  try {
    hooks = getDb().prepare("SELECT * FROM webhooks WHERE enabled = 1").all() as any[];
  } catch {
    return; // DB not ready yet
  }

  for (const hook of hooks) {
    let events: string[] = [];
    try { events = JSON.parse(hook.events); } catch { continue; }
    if (!events.includes(event)) continue;

    const body = JSON.stringify({ event, data, timestamp: Date.now() });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (hook.secret) {
      const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
      headers['X-Transcodarr-Signature'] = `sha256=${sig}`;
    }

    fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) })
      .catch((err) => console.warn(`Webhook delivery failed (${hook.url}):`, err.message));
  }
}

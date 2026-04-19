import { createHmac } from 'crypto';
import { getDb } from './db.js';
import { isPrivateUrl } from './ssrf.js';

async function deliverWithRetry(
  hookId: string,
  url: string,
  headers: Record<string, string>,
  body: string,
  attempt = 1,
): Promise<void> {
  const markDelivery = (ok: boolean) => {
    try {
      getDb().prepare('UPDATE webhooks SET last_fired = ?, last_delivery_ok = ? WHERE id = ?')
        .run(Math.floor(Date.now() / 1000), ok ? 1 : 0, hookId);
    } catch { /* non-critical */ }
  };
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    markDelivery(true);
  } catch (err: any) {
    if (attempt >= 3) {
      console.warn(`[Webhooks] Delivery failed after 3 attempts (${url}):`, err.message);
      markDelivery(false);
      return;
    }
    // Exponential backoff: 5s, 10s
    setTimeout(() => deliverWithRetry(hookId, url, headers, body, attempt + 1), attempt * 5_000);
  }
}

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
    // SSRF guard — skip delivery to private/internal addresses (defence-in-depth alongside creation-time check)
    if (isPrivateUrl(hook.url)) {
      console.warn(`[Webhooks] Skipping delivery to private URL: ${hook.url}`);
      continue;
    }

    const body = JSON.stringify({ event, data, timestamp: Date.now() });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (hook.secret) {
      const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
      headers['X-Transcodarr-Signature'] = `sha256=${sig}`;
    }

    // Fire-and-forget with retry — don't await so we don't block the caller
    deliverWithRetry(hook.id, hook.url, headers, body).catch(() => {});
  }
}

import { createHmac } from 'crypto';
import { getDb } from './db.js';

/** Guard against SSRF — reject delivery to private/loopback/link-local addresses. */
function isPrivateUrl(urlStr: string): boolean {
  try {
    const { hostname, protocol } = new URL(urlStr);
    if (!['http:', 'https:'].includes(protocol)) return true;
    const lower = hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]'].includes(lower)) return true;
    const parts = lower.split('.').map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
    }
    return false;
  } catch { return true; }
}

async function deliverWithRetry(
  url: string,
  headers: Record<string, string>,
  body: string,
  attempt = 1,
): Promise<void> {
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err: any) {
    if (attempt >= 3) {
      console.warn(`[Webhooks] Delivery failed after 3 attempts (${url}):`, err.message);
      return;
    }
    // Exponential backoff: 5s, 10s
    setTimeout(() => deliverWithRetry(url, headers, body, attempt + 1), attempt * 5_000);
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
    deliverWithRetry(hook.url, headers, body).catch(() => {});
  }
}

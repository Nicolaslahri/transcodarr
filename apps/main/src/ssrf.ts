/**
 * ssrf.ts — SSRF (Server-Side Request Forgery) guard utilities.
 *
 * Single source of truth for private-IP detection.
 * Imported by settings.ts (recipe import + webhook creation) and
 * webhooks.ts (delivery-time defence-in-depth check).
 */

/**
 * Returns true for URLs that resolve to private/loopback/link-local addresses,
 * or that use non-HTTP(S) schemes.  Treat parse errors as private (fail-closed).
 */
export function isPrivateUrl(urlStr: string): boolean {
  try {
    const { hostname, protocol } = new URL(urlStr);
    if (!['http:', 'https:'].includes(protocol)) return true; // block non-HTTP schemes
    const lower = hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]'].includes(lower)) return true;
    const parts = lower.split('.').map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      if (parts[0] === 10) return true;                                      // 10.x.x.x
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16–31.x.x
      if (parts[0] === 192 && parts[1] === 168) return true;                 // 192.168.x.x
      if (parts[0] === 169 && parts[1] === 254) return true;                 // link-local
    }
    return false;
  } catch { return true; } // unparseable URL → treat as private (fail-closed)
}

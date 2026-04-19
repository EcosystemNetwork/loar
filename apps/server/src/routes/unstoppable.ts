/**
 * Unstoppable Domains reverse-resolution proxy.
 *
 * The browser cannot call api.unstoppabledomains.com directly because the
 * endpoint requires bearer auth and serves no CORS headers. This proxy
 * holds the API key server-side and exposes a simple, cache-friendly
 * lookup the UI can hit through our own origin.
 *
 *   GET /api/ud/reverse/:address  →  { name: string|null, avatar: string|null }
 *
 * Returns { name: null, avatar: null } when:
 *   - UNSTOPPABLE_DOMAINS_API_KEY is unset (graceful no-op)
 *   - the address has no UD reverse record
 *   - upstream errors (logged, never thrown to the client)
 */
import { Hono } from 'hono';

export const unstoppableRoutes = new Hono();

const UD_API_BASE = 'https://api.unstoppabledomains.com';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  name: string | null;
  avatar: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function setCachedHeaders(c: any) {
  // Allow shared caches (CDN, browser) to hold the response so we don't
  // hit UD on every wallet-button render.
  c.header('Cache-Control', 'public, max-age=600, s-maxage=600');
}

unstoppableRoutes.get('/reverse/:address', async (c) => {
  const raw = c.req.param('address') || '';
  const address = raw.toLowerCase();

  if (!ADDRESS_RE.test(address)) {
    return c.json({ code: 'BAD_REQUEST', message: 'Invalid address' }, 400);
  }

  const now = Date.now();
  const cached = cache.get(address);
  if (cached && cached.expiresAt > now) {
    setCachedHeaders(c);
    return c.json({ name: cached.name, avatar: cached.avatar });
  }

  const apiKey = process.env.UNSTOPPABLE_DOMAINS_API_KEY;
  if (!apiKey) {
    // Graceful degrade — feature simply unavailable until configured.
    setCachedHeaders(c);
    return c.json({ name: null, avatar: null });
  }

  try {
    const res = await fetch(`${UD_API_BASE}/resolve/reverse/${address}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    // 404 == no reverse record set; treat as a successful negative result.
    if (res.status === 404) {
      cache.set(address, { name: null, avatar: null, expiresAt: now + CACHE_TTL_MS });
      setCachedHeaders(c);
      return c.json({ name: null, avatar: null });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[ud] upstream ${res.status} for ${address}: ${text.slice(0, 200)}`);
      // Negative cache for a short window so repeated failures don't hammer UD.
      cache.set(address, { name: null, avatar: null, expiresAt: now + 60_000 });
      return c.json({ name: null, avatar: null });
    }

    const data = (await res.json()) as {
      meta?: { domain?: string };
      records?: Record<string, string>;
    };
    const name = data?.meta?.domain ?? null;
    const avatar = data?.records?.['social.picture.value'] ?? null;

    cache.set(address, { name, avatar, expiresAt: now + CACHE_TTL_MS });
    setCachedHeaders(c);
    return c.json({ name, avatar });
  } catch (err) {
    console.warn(`[ud] fetch failed for ${address}:`, err instanceof Error ? err.message : err);
    return c.json({ name: null, avatar: null });
  }
});

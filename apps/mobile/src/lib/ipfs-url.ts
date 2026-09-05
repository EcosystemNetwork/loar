/**
 * IPFS URL resolver for React Native.
 *
 * Mirrors the behavior of apps/web/src/utils/ipfs-url.ts so mobile `<Image>`
 * components can consume the same Pinata dedicated-gateway URLs that the web
 * uses (which 401 without a gateway token).
 *
 * SEC-4: this file used to read `EXPO_PUBLIC_PINATA_GATEWAY_TOKEN` and embed
 * it directly in every dedicated-gateway image URL. Expo/Metro inlines all
 * `EXPO_PUBLIC_*` vars into the built JS bundle, so the token shipped in the
 * app binary (extractable via static bundle unpacking, no TLS interception
 * even needed) — anyone could lift it and proxy unlimited content through
 * our paid gateway. This is the exact "WEB-1" bug already found and fixed on
 * web (see apps/server/src/routes/ipfs.ts): the token now lives only on the
 * server, and clients ask `/api/ipfs/resolve` to compose the URL.
 *
 * `resolveIpfsUrl` stays synchronous and always resolves to the *public*
 * gateway (no token needed, safe for immediate use as an `<Image source>`).
 * `resolveIpfsUrlAsync` / `useIpfsUrl` ask the server for a short-lived
 * signed dedicated-gateway URL and upgrade to it once resolved — use these
 * where the faster dedicated gateway matters (e.g. above-the-fold images).
 *
 * Env:
 *   EXPO_PUBLIC_PINATA_GATEWAY_URL — dedicated gateway host; used only to
 *                                    detect `.mypinata.cloud` so we know to
 *                                    bypass to the public gateway for sync
 *                                    resolution (mobile never holds the token)
 *   EXPO_PUBLIC_SERVER_URL         — LOAR server base URL, used to fetch
 *                                    server-signed dedicated-gateway URLs
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const PUBLIC_GATEWAY = 'https://gateway.pinata.cloud';
const CONFIGURED_GATEWAY = (process.env.EXPO_PUBLIC_PINATA_GATEWAY_URL || PUBLIC_GATEWAY)
  .trim()
  .replace(/\/$/, '');

let CONFIGURED_HOST = '';
try {
  CONFIGURED_HOST = new URL(CONFIGURED_GATEWAY).host;
} catch {
  CONFIGURED_HOST = '';
}

const IS_DEDICATED = CONFIGURED_HOST.endsWith('.mypinata.cloud');
// The client never holds a gateway token (SEC-4) — a configured dedicated
// gateway always falls back to the public gateway for synchronous
// resolution. Use resolveIpfsUrlAsync/useIpfsUrl for the dedicated gateway.
const ACTIVE_GATEWAY = IS_DEDICATED ? PUBLIC_GATEWAY : CONFIGURED_GATEWAY;

// ── Dedicated gateway config (primed once per app launch) ────────────────
//
// Mirrors the web fix (apps/web/src/utils/ipfs-url.ts). `resolveIpfsUrl` is
// synchronous and used directly as an `<Image source>`, so without this it
// always pointed at `gateway.pinata.cloud` — rate-limited and ~8s TTFB
// unauthenticated — and only `useIpfsUrl` upgraded to the fast dedicated
// gateway, per CID, via `/api/ipfs/resolve`. Instead: fetch the gateway
// base + token once from `/api/ipfs/gateway-config` at app launch, cache it
// (memory + AsyncStorage for an instant warm start next launch), and let
// `resolveIpfsUrl` compose the dedicated URL synchronously. The token is no
// more exposed than `/api/ipfs/resolve` already makes it.
type DedicatedGatewayConfig = { base: string; host: string; token: string };
const DEDICATED_CFG_STORAGE_KEY = 'loar:ipfs-gateway-config:v1';

function normalizeDedicatedConfig(input: unknown): DedicatedGatewayConfig | null {
  if (!input || typeof input !== 'object') return null;
  const { base, host, token } = input as Record<string, unknown>;
  if (typeof base !== 'string' || typeof host !== 'string') return null;
  if (!host.endsWith('.mypinata.cloud')) return null;
  const trimmedBase = base.trim().replace(/\/$/, '');
  try {
    // A corrupted/schemeless base must never reach URL composition.
    if (new URL(trimmedBase).host !== host) return null;
  } catch {
    return null;
  }
  return { base: trimmedBase, host, token: typeof token === 'string' ? token : '' };
}

let dedicatedConfig: DedicatedGatewayConfig | null = null;
let dedicatedConfigPrimed: Promise<void> | null = null;

// Hydrate from the last launch's cache as early as possible — AsyncStorage is
// async, so this races screen mount; `useIpfsUrl` still upgrades if it loses.
void AsyncStorage.getItem(DEDICATED_CFG_STORAGE_KEY)
  .then((raw) => {
    if (raw && !dedicatedConfig) {
      const cfg = normalizeDedicatedConfig(JSON.parse(raw));
      if (cfg) dedicatedConfig = cfg;
    }
  })
  .catch(() => {
    /* no cache / parse error — prime() will fetch a fresh copy */
  });

/**
 * Fetch the dedicated gateway config once and cache it. Idempotent — repeat
 * calls return the same promise. Safe to call before the server is reachable;
 * on failure the public gateway still works and the next call retries.
 */
export async function primeIpfsGatewayConfig(): Promise<void> {
  if (dedicatedConfigPrimed) return dedicatedConfigPrimed;
  const run = (async () => {
    if (!SERVER_URL) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/ipfs/gateway-config`);
      if (!res.ok) return;
      const cfg = normalizeDedicatedConfig(await res.json());
      if (!cfg) return;
      dedicatedConfig = cfg;
      void AsyncStorage.setItem(DEDICATED_CFG_STORAGE_KEY, JSON.stringify(cfg)).catch(() => {});
    } catch {
      dedicatedConfigPrimed = null; // offline — retry on the next call
    }
  })();
  dedicatedConfigPrimed = run;
  return run;
}

/** Compose a dedicated-gateway URL for a `<cid>[/path][?query]` string, or
 *  null when the config hasn't been primed yet. Plain string work — avoids
 *  leaning on RN's partial `URLSearchParams`. */
function composeDedicatedUrl(cidPath: string): string | null {
  const cfg = dedicatedConfig;
  if (!cfg || !cidPath) return null;
  const [rawPath, rawQuery] = cidPath.split('?');
  const kept = (rawQuery ? rawQuery.split('&') : []).filter(
    (p) => p && !p.startsWith('pinataGatewayToken=')
  );
  if (cfg.token) kept.push(`pinataGatewayToken=${encodeURIComponent(cfg.token)}`);
  const qs = kept.join('&');
  return `${cfg.base}/ipfs/${rawPath}${qs ? `?${qs}` : ''}`;
}

/** Strip any stale `pinataGatewayToken` query param and route through the
 *  public gateway — mirrors web's `appendToken`/`rewriteBrokenDedicatedUrl`,
 *  which likewise never trust a client-visible token. */
function toPublicGateway(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud')) return url;
    parsed.searchParams.delete('pinataGatewayToken');
    parsed.host = 'gateway.pinata.cloud';
    return parsed.toString();
  } catch {
    return url;
  }
}

export function resolveIpfsUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('ipfs://')) {
    const cid = url.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return composeDedicatedUrl(cid) ?? `${ACTIVE_GATEWAY}/ipfs/${cid}`;
  }
  // Once the dedicated gateway config is primed, route known `/ipfs/<cid>`
  // URLs straight to it. Cold launch (pre-prime) falls through to the
  // public-gateway rewrite unchanged.
  const cidPath = cidPathFor(url);
  const dedicated = cidPath ? composeDedicatedUrl(cidPath) : null;
  return dedicated ?? toPublicGateway(url);
}

// ── Server-signed gateway URL (mirrors web's WEB-1 fix) ──────────────────

const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL || '').replace(/\/$/, '');
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function cidPathFor(url: string): string | null {
  if (url.startsWith('ipfs://')) {
    return url.slice('ipfs://'.length).replace(/^ipfs\//, '') || null;
  }
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/ipfs\/(.+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Ask the server to compose a short-lived signed dedicated-gateway URL.
 *  The gateway token never leaves the server (see GET /api/ipfs/resolve).
 *  Falls back to the public-gateway URL on any failure. */
export async function resolveIpfsUrlAsync(url?: string | null): Promise<string> {
  if (!url) return '';
  const cidPath = cidPathFor(url);
  if (!cidPath || !SERVER_URL) return resolveIpfsUrl(url);

  const cached = signedUrlCache.get(cidPath);
  if (cached && cached.expiresAt > Date.now() + 10_000) return cached.url;

  try {
    const res = await fetch(`${SERVER_URL}/api/ipfs/resolve?url=${encodeURIComponent(url)}`);
    if (!res.ok) return resolveIpfsUrl(url);
    const json = (await res.json()) as { url?: string; expiresAt?: number };
    if (!json.url) return resolveIpfsUrl(url);
    signedUrlCache.set(cidPath, {
      url: json.url,
      expiresAt: json.expiresAt ?? Date.now() + 60_000,
    });
    return json.url;
  } catch {
    return resolveIpfsUrl(url);
  }
}

/** React hook: returns the public-gateway URL immediately, then upgrades to
 *  the server-signed dedicated-gateway URL once it resolves. Use in place of
 *  a bare `resolveIpfsUrl(url)` wherever the faster dedicated gateway is
 *  worth the async round trip (e.g. `<Image source={{ uri: useIpfsUrl(x) }}>`). */
export function useIpfsUrl(url?: string | null): string {
  const [resolved, setResolved] = useState(() => resolveIpfsUrl(url));

  useEffect(() => {
    let cancelled = false;
    setResolved(resolveIpfsUrl(url));
    if (url) {
      void resolveIpfsUrlAsync(url).then((signed) => {
        if (!cancelled) setResolved(signed);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [url]);

  return resolved;
}

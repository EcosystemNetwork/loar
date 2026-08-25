// Default public gateway for anonymous (client-side) reads.
//
// We use a PATH-STYLE gateway (ipfs.io) rather than a subdomain-redirect one
// (w3s.link / dweb.link). Most LOAR content is pinned under CIDv0 (`Qm…`)
// hashes, and subdomain gateways 307→`<cid>.ipfs.<host>` which only resolves
// for CIDv1 — so w3s.link/dweb.link stall for ~15s+ on our CIDv0 content while
// ipfs.io serves it path-style in well under a second. (Measured 2026-06-12.)
// gateway.pinata.cloud also works but is rate-limited and slow (~8s ttfb)
// unauthenticated, so it sits lower in the chain.
const PUBLIC_GATEWAY = 'https://ipfs.io';
// Pinata's public gateway is kept in the fallback chain — it sometimes
// recovers — but is not used as the sync default.
const PINATA_PUBLIC_GATEWAY = 'https://gateway.pinata.cloud';
const CONFIGURED_GATEWAY = (import.meta.env.VITE_PINATA_GATEWAY_URL || PUBLIC_GATEWAY)
  .trim()
  .replace(/\/$/, '');
const PREFER_PUBLIC =
  String(import.meta.env.VITE_PINATA_PREFER_PUBLIC || '')
    .trim()
    .toLowerCase() === 'true';

let CONFIGURED_HOST = '';
try {
  CONFIGURED_HOST = new URL(CONFIGURED_GATEWAY).host;
} catch {
  CONFIGURED_HOST = '';
}

const IS_DEDICATED_GATEWAY = CONFIGURED_HOST.endsWith('.mypinata.cloud');
// Dedicated `.mypinata.cloud` gateways require a server-signed URL (see
// resolveIpfsUrlAsync). Fall back to the public gateway for synchronous
// URL composition.
const BYPASS_DEDICATED = PREFER_PUBLIC || IS_DEDICATED_GATEWAY;

const ACTIVE_GATEWAY = BYPASS_DEDICATED ? PUBLIC_GATEWAY : CONFIGURED_GATEWAY;
let PUBLIC_GATEWAY_HOST = '';
try {
  PUBLIC_GATEWAY_HOST = new URL(PUBLIC_GATEWAY).host;
} catch {
  PUBLIC_GATEWAY_HOST = '';
}
const ACTIVE_HOST = BYPASS_DEDICATED ? PUBLIC_GATEWAY_HOST : CONFIGURED_HOST;

function appendToken(url: string): string {
  // The Pinata gateway token is server-side only, so strip any stale
  // `pinataGatewayToken` query param off URLs reaching the client.
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud') && parsed.host !== ACTIVE_HOST) return url;
    parsed.searchParams.delete('pinataGatewayToken');
    return parsed.toString();
  } catch {
    return url;
  }
}

function rewriteBrokenDedicatedGatewayUrl(url: string): string {
  // Dedicated `.mypinata.cloud` gateways require a server-side token that
  // the client never has — always rewrite to the active public gateway in
  // sync resolution. Async/signed flows go through resolveIpfsUrlAsync.
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud')) return url;
    parsed.searchParams.delete('pinataGatewayToken');
    return `${ACTIVE_GATEWAY}${parsed.pathname}${parsed.search ? parsed.search : ''}`;
  } catch {
    return url;
  }
}

export function resolveIpfsUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('ipfs://')) {
    const path = url.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return appendToken(`${ACTIVE_GATEWAY}/ipfs/${path}`);
  }
  return appendToken(rewriteBrokenDedicatedGatewayUrl(url));
}

// Public fallback chain. Pinata dedicated gateways and gateway.pinata.cloud
// both 401/403/429 unauthenticated traffic; these resolve any CID that's live
// on the IPFS network. We try multiple in case any single one is degraded.
// Ordered fastest/most-reliable first for our CIDv0 content. Path-style
// gateways lead; subdomain-redirect gateways (w3s.link/dweb.link) trail since
// they stall on CIDv0. raceIpfsGateways() probes these in parallel anyway, so
// a degraded leader can't block — but the order sets the sync-default and the
// onError fallback sequence.
// cloudflare-ipfs.com was removed 2026-08-24: Cloudflare shut down its public
// IPFS gateway (NXDOMAIN now), so every hop through it was a guaranteed dead
// end that burned part of the MAX_HOPS budget before reaching a live gateway.
const PUBLIC_FALLBACK_GATEWAYS = [
  'https://ipfs.io',
  PINATA_PUBLIC_GATEWAY,
  'https://dweb.link',
  'https://w3s.link',
];

const KNOWN_GATEWAY_HOSTS = new Set<string>([
  'gateway.pinata.cloud',
  'w3s.link',
  'ipfs.io',
  'dweb.link',
  '4everland.io',
  'nftstorage.link',
]);

// Extract the "<cid>[/sub/path][?query]" portion of a known IPFS URL.
// Returns null if the URL isn't an IPFS gateway URL we recognize.
function extractIpfsPath(url: string): { cidPath: string } | null {
  if (!url) return null;
  if (url.startsWith('ipfs://')) {
    const cidPath = url.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return cidPath ? { cidPath } : null;
  }
  try {
    const parsed = new URL(url);
    const isKnown =
      parsed.host.endsWith('.mypinata.cloud') ||
      KNOWN_GATEWAY_HOSTS.has(parsed.host) ||
      parsed.host.endsWith('.ipfs.dweb.link') ||
      parsed.host.endsWith('.ipfs.w3s.link');
    if (!isKnown) return null;

    const subdomainMatch = parsed.host.match(/^([^.]+)\.ipfs\./);
    if (subdomainMatch) {
      const cid = subdomainMatch[1];
      const rest = parsed.pathname.replace(/^\//, '');
      const cidPath = rest ? `${cid}/${rest}` : cid;
      return { cidPath: cidPath + (parsed.search || '') };
    }

    const pathMatch = parsed.pathname.match(/^\/ipfs\/(.+)$/);
    if (pathMatch) {
      const rest = pathMatch[1];
      const search = new URLSearchParams(parsed.search);
      search.delete('pinataGatewayToken');
      const searchStr = search.toString();
      return { cidPath: rest + (searchStr ? `?${searchStr}` : '') };
    }
    return null;
  } catch {
    return null;
  }
}

// Ordered list of gateway URLs to try for a given source URL.
// Primary = whatever resolveIpfsUrl produced; fallbacks = public gateways.
export function getIpfsUrlCandidates(url?: string | null): string[] {
  const primary = resolveIpfsUrl(url);
  if (!primary) return [];
  const parts = extractIpfsPath(url || primary);
  if (!parts) return [primary];

  const fallbacks = PUBLIC_FALLBACK_GATEWAYS.map((gw) => `${gw}/ipfs/${parts.cidPath}`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [primary, ...fallbacks]) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

// Given a URL that just failed, return the next gateway URL to try,
// or null if the chain is exhausted.
export function getNextIpfsFallback(currentUrl?: string | null): string | null {
  if (!currentUrl) return null;
  const candidates = getIpfsUrlCandidatesPreferred(currentUrl);
  if (candidates.length <= 1) return null;

  const idx = candidates.findIndex((c) => c === currentUrl);
  if (idx !== -1) return candidates[idx + 1] ?? null;

  const currentParts = extractIpfsPath(currentUrl);
  if (!currentParts) return null;
  const currentCid = currentParts.cidPath.split('?')[0];
  const matchIdx = candidates.findIndex((c) => {
    const p = extractIpfsPath(c);
    return p?.cidPath.split('?')[0] === currentCid;
  });
  if (matchIdx === -1) return candidates[0] ?? null;
  return candidates[matchIdx + 1] ?? null;
}

export function isIpfsGatewayUrl(url?: string | null): boolean {
  if (!url) return false;
  return extractIpfsPath(url) !== null;
}

// Race the candidate gateways in parallel and resolve to whichever one
// returns a 2xx HEAD response first. Used when we want to discover the
// fastest live gateway without serially waiting for each to time out.
// Falls back to the first candidate if every probe fails or the timeout
// elapses, so callers can always proceed.
export async function raceIpfsGateways(
  url?: string | null,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<string | null> {
  const candidates = getIpfsUrlCandidates(url);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const timeoutMs = opts.timeoutMs ?? 4000;

  return new Promise((resolve) => {
    let settled = false;
    // Populated if/when our own dedicated gateway resolves (see below). Preferred
    // over the public-gateway primary as the last-resort fallback, since it's the
    // one we've actually measured as fast/reliable — the public primary is
    // whatever public gateway happens to be first (ipfs.io), which is exactly the
    // one known to occasionally hang for 20s+ before failing.
    let dedicatedUrl: string | null = null;
    const controllers: AbortController[] = [];

    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      for (const c of controllers) {
        try {
          c.abort();
        } catch {
          /* ignore */
        }
      }
      resolve(result);
    };

    if (opts.signal) {
      opts.signal.addEventListener('abort', () => finish(dedicatedUrl || candidates[0]), {
        once: true,
      });
    }

    let pending = candidates.length;
    for (const candidate of candidates) {
      const controller = new AbortController();
      controllers.push(controller);
      fetch(candidate, { method: 'HEAD', signal: controller.signal, mode: 'cors' })
        .then((res) => {
          if (res.ok) finish(candidate);
          else if (--pending === 0) finish(dedicatedUrl || candidates[0]);
        })
        .catch(() => {
          if (--pending === 0) finish(dedicatedUrl || candidates[0]);
        });
    }

    // Race our own dedicated gateway (server-signed, WEB-1) alongside the public
    // gateways above. The server already serves this gateway live, so it needs no
    // separate HEAD probe — first live result of either kind wins. Falls through
    // to a no-op (resolves to the public primary) when VITE_SERVER_URL isn't
    // configured, so dev without a server behaves exactly as before.
    resolveIpfsUrlAsync(url)
      .then((resolved) => {
        if (!resolved || resolved === candidates[0]) return;
        dedicatedUrl = resolved;
        finish(resolved);
      })
      .catch(() => {
        /* lookup failed — public gateway race still runs unaffected */
      });

    setTimeout(() => finish(dedicatedUrl || candidates[0]), timeoutMs);
  });
}

// ── Server-signed gateway URL (WEB-1) ─────────────────────────────────────
//
// For cases where a dedicated (token-gated) Pinata gateway is required —
// typically private/token-gated content — ask the server to compose the URL.
// The gateway token stays on the server; the returned URL is short-lived.
// Successful lookups are cached in-memory per session to keep render paths
// snappy. Failures fall through to the public-gateway URL.

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
// In-flight dedup: multiple elements resolving the same CID concurrently
// (e.g. a grid of thumbnails sharing a CID, or an effect that fires twice)
// share one fetch instead of each racing their own /api/ipfs/resolve call —
// avoids doubling load on the server's per-IP rate limit for no benefit,
// since they'd all resolve to the same signed URL anyway.
const inFlightResolves = new Map<string, Promise<string>>();

export async function resolveIpfsUrlAsync(url?: string | null): Promise<string> {
  if (!url) return '';
  const parts = extractIpfsPath(url);
  if (!parts) return resolveIpfsUrl(url);

  const cacheKey = parts.cidPath.split('?')[0];
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 10_000) return cached.url;

  if (!SERVER_URL) return resolveIpfsUrl(url);

  const inFlight = inFlightResolves.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/ipfs/resolve?url=${encodeURIComponent(url)}`, {
        credentials: 'include',
      });
      if (!res.ok) return resolveIpfsUrl(url);
      const json = (await res.json()) as { url?: string; expiresAt?: number };
      if (!json.url) return resolveIpfsUrl(url);
      signedUrlCache.set(cacheKey, {
        url: json.url,
        expiresAt: json.expiresAt ?? Date.now() + 60_000,
      });
      return json.url;
    } catch {
      return resolveIpfsUrl(url);
    } finally {
      inFlightResolves.delete(cacheKey);
    }
  })();

  inFlightResolves.set(cacheKey, promise);
  return promise;
}

// Sync candidate chain, preferring our own dedicated gateway when it's already
// warm in signedUrlCache (e.g. resolved earlier for this CID by this call
// itself, by raceIpfsGateways, or by another element on the page). Used by
// every *synchronous* fallback consumer — SmartImage, BranchingPlayer, and the
// global onerror rotator in install-ipfs-fallback.ts — none of which can await
// a network round trip mid-render or mid-event-handler.
//
// Cold cache (nothing resolved yet): behaves exactly like getIpfsUrlCandidates
// and kicks off a background resolve so the *next* call — the next onerror hop
// for this element, or any other element sharing the CID — has a shot at the
// warm cache instead of falling through to whichever public gateway is
// currently degraded.
export function getIpfsUrlCandidatesPreferred(url?: string | null): string[] {
  const candidates = getIpfsUrlCandidates(url);
  if (candidates.length === 0) return candidates;

  const parts = extractIpfsPath(url || candidates[0]);
  const cacheKey = parts?.cidPath.split('?')[0];
  const cached = cacheKey ? signedUrlCache.get(cacheKey) : undefined;
  const dedicated = cached && cached.expiresAt > Date.now() ? cached.url : null;

  // Fire-and-forget — resolveIpfsUrlAsync no-ops against its own cache when a
  // fresh entry already exists, so this is cheap on repeated calls.
  void resolveIpfsUrlAsync(url);

  if (!dedicated || dedicated === candidates[0]) return candidates;
  return [dedicated, ...candidates.filter((c) => c !== dedicated)];
}

// Drop-in, cache-aware replacement for `resolveIpfsUrl()` for call sites that
// render a single <video>/<audio>/<img> src synchronously (no local retry
// state of their own) and just want "the best URL we currently know about".
// Returns our dedicated (authenticated) gateway when it's already warm in
// signedUrlCache — e.g. another element on the page resolved this CID first,
// or a prior render of this same element did — and the public primary
// otherwise, while kicking off a background resolve so a *later* render or
// the global onerror rotator (install-ipfs-fallback.ts) can pick up the
// dedicated URL once it lands. Public gateways (ipfs.io, gateway.pinata.cloud
// unauthenticated) are rate-limited/degraded far more often than our own
// signed gateway, so preferring the warm cache measurably cuts 429/504s for
// callers that don't run their own race/fallback chain.
export function resolveIpfsUrlPreferred(url?: string | null): string {
  const candidates = getIpfsUrlCandidatesPreferred(url);
  return candidates[0] || resolveIpfsUrl(url);
}

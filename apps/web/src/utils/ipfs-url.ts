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
const PREFER_PUBLIC =
  String(import.meta.env.VITE_PINATA_PREFER_PUBLIC || '')
    .trim()
    .toLowerCase() === 'true';

/**
 * Decides which gateway every synchronous URL rewrite (rewriteBrokenDedicatedGatewayUrl,
 * the `ipfs://` branch of resolveIpfsUrl) should target, given the raw
 * `VITE_PINATA_GATEWAY_URL` build value.
 *
 * MUST fall back to `publicGateway` whenever `configuredGatewayRaw` doesn't
 * parse as an absolute URL — not just when it happens to resolve to a known
 * `.mypinata.cloud` host. Before this fix, an env var missing its `https://`
 * scheme (e.g. a copy-paste error dropping the protocol, or a stray trailing
 * character after the host) made `new URL(...)` throw, `configuredHost` come
 * back `''`, `isDedicatedGateway` come back `false` (since `''` doesn't end
 * in `.mypinata.cloud`) — and the code concluded there was nothing to bypass,
 * so it used the raw, unparseable string as `activeGateway` anyway.
 * `rewriteBrokenDedicatedGatewayUrl` then baked that broken, schemeless
 * string into every `.mypinata.cloud` video/image URL app-wide — and because
 * it no longer parses as a URL at all, `isIpfsGatewayUrl()` can't recognize
 * it as a gateway URL either, so `install-ipfs-fallback.ts`'s global
 * onerror rotator can't recover it back to a working gateway — every single
 * piece of media on the affected host permanently fails, all the way down
 * to a "Couldn't load"/"Add Video" placeholder, with no console error
 * pointing at the actual cause. See `apps/web/src/utils/__tests__/ipfs-url.test.ts`
 * for the exact reproduction.
 */
export function resolveActiveGateway(
  configuredGatewayRaw: string | undefined,
  preferPublic: boolean,
  publicGateway: string
): { activeGateway: string; activeHost: string; isDedicatedGateway: boolean } {
  const configuredGateway = (configuredGatewayRaw || publicGateway).trim().replace(/\/$/, '');

  let configuredHost = '';
  let configuredGatewayValid = false;
  try {
    configuredHost = new URL(configuredGateway).host;
    configuredGatewayValid = true;
  } catch {
    configuredHost = '';
    configuredGatewayValid = false;
  }

  const isDedicatedGateway = configuredHost.endsWith('.mypinata.cloud');
  // Dedicated `.mypinata.cloud` gateways require a server-signed URL (see
  // resolveIpfsUrlAsync) — bypass to the public gateway for synchronous URL
  // composition. An unparseable configured value is bypassed unconditionally:
  // an invalid URL is never safe to use as a prefix, dedicated or not.
  const bypassDedicated = preferPublic || isDedicatedGateway || !configuredGatewayValid;

  let publicGatewayHost = '';
  try {
    publicGatewayHost = new URL(publicGateway).host;
  } catch {
    publicGatewayHost = '';
  }

  return {
    activeGateway: bypassDedicated ? publicGateway : configuredGateway,
    activeHost: bypassDedicated ? publicGatewayHost : configuredHost,
    isDedicatedGateway,
  };
}

const { activeGateway: ACTIVE_GATEWAY, activeHost: ACTIVE_HOST } = resolveActiveGateway(
  import.meta.env.VITE_PINATA_GATEWAY_URL,
  PREFER_PUBLIC,
  PUBLIC_GATEWAY
);

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
  // Callers sometimes pass through a Ponder EMPTY_RESULT proxy (returned when
  // the indexer is disabled/offline) instead of a real string — it's truthy
  // but has no real string methods, so guard the type explicitly rather than
  // just falsiness.
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('ipfs://')) {
    const path = url.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return composeDedicatedUrl(path) ?? appendToken(`${ACTIVE_GATEWAY}/ipfs/${path}`);
  }
  // Once the dedicated gateway config is primed, route known IPFS URLs
  // straight to it — it's the fast, reliable path. Cold cache (first visit,
  // pre-prime) falls through to the public-gateway rewrite below unchanged.
  const parts = extractIpfsPath(url);
  const dedicated = parts ? composeDedicatedUrl(parts.cidPath) : null;
  if (dedicated) return dedicated;
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

// ── Dedicated gateway config (primed once per session) ──────────────────
//
// The server's dedicated Pinata gateway (`<name>.mypinata.cloud`) is
// CDN-backed with our content pinned hot — dramatically faster and steadier
// than any public gateway. The catch is it needs a token the static JS
// bundle must not carry (WEB-1), so historically the client could only reach
// it via a per-CID round trip to `/api/ipfs/resolve`, and *first paint* for
// every asset started on `ipfs.io` — which, per this file's own notes, can
// hang 20s+ before failing. `raceIpfsGateways` only upgrades away from that
// after a 2.5s timeout, and on timeout falls right back to `ipfs.io`.
//
// Instead: fetch the gateway base + token once per session from
// `/api/ipfs/gateway-config` (primeIpfsGatewayConfig, called at app boot),
// cache it in localStorage for an instant warm start on repeat visits, and
// use it as the *primary* synchronous candidate. The token is no more
// exposed than `/api/ipfs/resolve` already makes it (that endpoint bakes it
// into every media URL it returns).
type DedicatedGatewayConfig = { base: string; host: string; token: string };
const DEDICATED_CFG_LS_KEY = 'loar:ipfs-gateway-config:v1';

function normalizeDedicatedConfig(input: unknown): DedicatedGatewayConfig | null {
  if (!input || typeof input !== 'object') return null;
  const { base, host, token } = input as Record<string, unknown>;
  if (typeof base !== 'string' || typeof host !== 'string') return null;
  if (!host.endsWith('.mypinata.cloud')) return null;
  const trimmedBase = base.trim().replace(/\/$/, '');
  try {
    // A corrupted/schemeless base must never reach URL composition — that was
    // the exact 2026-08-25 incident behind resolveActiveGateway's test suite.
    if (new URL(trimmedBase).host !== host) return null;
  } catch {
    return null;
  }
  return { base: trimmedBase, host, token: typeof token === 'string' ? token : '' };
}

function readCachedDedicatedConfig(): DedicatedGatewayConfig | null {
  try {
    const raw = localStorage.getItem(DEDICATED_CFG_LS_KEY);
    return raw ? normalizeDedicatedConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

let dedicatedConfig: DedicatedGatewayConfig | null = readCachedDedicatedConfig();
let dedicatedConfigPrimed: Promise<void> | null = null;

/**
 * Fetch the dedicated gateway config once and cache it (memory + localStorage).
 * Idempotent — repeat calls return the same in-flight/settled promise. Safe to
 * call before the server is reachable: on failure the public gateways still
 * work, and the next call retries.
 */
export function primeIpfsGatewayConfig(): Promise<void> {
  if (dedicatedConfigPrimed) return dedicatedConfigPrimed;
  const run = (async () => {
    if (!SERVER_URL) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/ipfs/gateway-config`, { credentials: 'omit' });
      if (!res.ok) return;
      const cfg = normalizeDedicatedConfig(await res.json());
      if (!cfg) return;
      dedicatedConfig = cfg;
      try {
        localStorage.setItem(DEDICATED_CFG_LS_KEY, JSON.stringify(cfg));
      } catch {
        /* private mode / quota — in-memory config is enough for this session */
      }
    } catch {
      // Offline or server down — retry on the next call.
      dedicatedConfigPrimed = null;
    }
  })();
  dedicatedConfigPrimed = run;
  return run;
}

/**
 * Compose a dedicated-gateway URL for a `<cid>[/path][?query]` string, or null
 * when the config hasn't been primed yet (cold first visit) — callers then
 * fall back to the public primary and the background race upgrades later.
 */
function composeDedicatedUrl(cidPath: string): string | null {
  const cfg = dedicatedConfig;
  if (!cfg || !cidPath) return null;
  const [path, query] = cidPath.split('?');
  const params = new URLSearchParams(query || '');
  params.delete('pinataGatewayToken');
  if (cfg.token) params.set('pinataGatewayToken', cfg.token);
  const qs = params.toString();
  return `${cfg.base}/ipfs/${path}${qs ? `?${qs}` : ''}`;
}

// ── Concurrency gate ────────────────────────────────────────────────────
//
// A media-heavy page (market/discover/gallery) can mount dozens of
// SmartImage/useResolvedIpfsUrl instances at once, each resolving a
// distinct CID. Per-CID dedup (inFlightResolves, below) only collapses
// *repeat* requests for the same CID — it does nothing for 20+ genuinely
// different thumbnails loading together, which otherwise fan out into a
// burst of simultaneous requests against both our own /api/ipfs/resolve
// endpoint (per-IP rate-limited server-side) and public IPFS gateways
// (rate-limited/flaky on their own, see raceIpfsGateways). Two small
// semaphores cap how many of each run at once; a large page queues the
// rest instead of firing everything in the same tick.
function createSemaphore(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next();
  };
  return function acquire(): Promise<() => void> {
    if (active < max) {
      active++;
      return Promise.resolve(release);
    }
    return new Promise((resolve) => {
      queue.push(() => {
        active++;
        resolve(release);
      });
    });
  };
}

// Gates calls to our own /api/ipfs/resolve endpoint.
const acquireResolveSlot = createSemaphore(6);
// Gates whole raceIpfsGateways() sessions (each fans out to ~4 public
// gateways), independently of the resolve gate above.
const acquireGatewayRaceSlot = createSemaphore(6);

// ── Per-host circuit breaker ────────────────────────────────────────────
//
// The semaphore above caps concurrent race *sessions*, but a media-heavy
// page still mounts one SmartImage/ModelViewer/etc. per asset — each with
// its own distinct CID, so the per-CID dedup above doesn't collapse them.
// A gallery of dozens of items therefore queues dozens of raceIpfsGateways()
// sessions in quick succession, and every single one blindly re-probes all
// ~4 public gateways regardless of whether one of them just answered 429
// seconds ago. That turns "one gateway is rate-limited" into "every
// subsequent asset on the page adds another request to the gateway that's
// already rate-limited" — worsening the exact condition that caused the
// 429 in the first place, and starving every other pending race of a slot
// while they wait out a host that's already known to be throttled.
//
// A 429 is a capacity signal from the gateway itself (unlike a 404/504,
// which is usually per-CID/per-content rather than a statement about the
// whole host), so once one lands, skip that host from new probes for a
// short cooldown — self-healing, not a permanent block.
const GATEWAY_COOLDOWN_MS = 20_000;
const gatewayCooldownUntil = new Map<string, number>();

function isGatewayCoolingDown(candidateUrl: string): boolean {
  try {
    const until = gatewayCooldownUntil.get(new URL(candidateUrl).host);
    return typeof until === 'number' && until > Date.now();
  } catch {
    return false;
  }
}

function markGatewayRateLimited(candidateUrl: string): void {
  try {
    gatewayCooldownUntil.set(new URL(candidateUrl).host, Date.now() + GATEWAY_COOLDOWN_MS);
  } catch {
    /* unparseable URL — nothing to key the cooldown on */
  }
}

// Extract the "<cid>[/sub/path][?query]" portion of a known IPFS URL.
// Returns null if the URL isn't an IPFS gateway URL we recognize.
function extractIpfsPath(url: string): { cidPath: string } | null {
  if (!url || typeof url !== 'string') return null;
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

  // `primary` is already the dedicated URL when the config is primed; when it
  // isn't, prepend it anyway once available so the onError chain and the
  // global rotator can still reach it. Public gateways trail as fallbacks.
  const dedicated = composeDedicatedUrl(parts.cidPath);
  const fallbacks = PUBLIC_FALLBACK_GATEWAYS.map((gw) => `${gw}/ipfs/${parts.cidPath}`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [dedicated, primary, ...fallbacks].filter((c): c is string =>
    Boolean(c)
  )) {
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
  const release = await acquireGatewayRaceSlot();
  if (opts.signal?.aborted) {
    release();
    return candidates[0];
  }

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
      release();
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
    // Every public probe failing/cooling-down is not, by itself, a reason to
    // lock in `candidates[0]` — that's the unverified public primary, and if
    // every public gateway just failed then it's the LEAST likely of all of
    // them to actually work. `resolveIpfsUrlAsync` (our dedicated gateway) is
    // still in flight at this point far more often than not: public probes
    // can fail near-instantly (a CORS/NotSameOrigin rejection resolves before
    // any bytes move), while the dedicated lookup is a real round trip to our
    // own server. Only fall back to the unverified primary here if the
    // dedicated URL is already known — otherwise let that in-flight lookup's
    // own `.then` (or, failing that, the timeout below) make the call.
    const onProbeExhausted = () => {
      if (--pending === 0 && dedicatedUrl) finish(dedicatedUrl);
    };
    for (const candidate of candidates) {
      if (isGatewayCoolingDown(candidate)) {
        onProbeExhausted();
        continue;
      }
      const controller = new AbortController();
      controllers.push(controller);
      fetch(candidate, { method: 'HEAD', signal: controller.signal, mode: 'cors' })
        .then((res) => {
          if (res.ok) finish(candidate);
          else {
            if (res.status === 429) markGatewayRateLimited(candidate);
            onProbeExhausted();
          }
        })
        .catch(() => {
          onProbeExhausted();
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

// Mirrors SERVER_URL resolution in utils/query-client.ts (itself a mirror of
// utils/trpc.ts). Without the PROD fallback, a production build that ships
// without VITE_SERVER_URL leaves this empty — resolveIpfsUrlAsync then never
// calls /api/ipfs/resolve, so every piece of media is stuck on the public
// gateways (ipfs.io / gateway.pinata.cloud), which rate-limit (429) and time
// out (504) under real traffic. The rest of the app dodges this via the
// query-client fallback; IPFS resolution needs the same safety net.
const PROD_SERVER_URL = 'https://api.loar.fun';
const RAW_SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').trim().replace(/\/$/, '');
const SERVER_URL = RAW_SERVER_URL || (import.meta.env.PROD ? PROD_SERVER_URL : '');
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
// In-flight dedup: multiple elements resolving the same CID concurrently
// (e.g. a grid of thumbnails sharing a CID, or an effect that fires twice)
// share one fetch instead of each racing their own /api/ipfs/resolve call —
// avoids doubling load on the server's per-IP rate limit for no benefit,
// since they'd all resolve to the same signed URL anyway.
const inFlightResolves = new Map<string, Promise<string>>();

export async function resolveIpfsUrlAsync(url?: string | null): Promise<string> {
  if (!url || typeof url !== 'string') return '';
  const parts = extractIpfsPath(url);
  if (!parts) return resolveIpfsUrl(url);

  const cacheKey = parts.cidPath.split('?')[0];
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 10_000) return cached.url;

  if (!SERVER_URL) return resolveIpfsUrl(url);

  const inFlight = inFlightResolves.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const release = await acquireResolveSlot();
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
      release();
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

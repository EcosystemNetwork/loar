const PUBLIC_GATEWAY = 'https://gateway.pinata.cloud';
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
const ACTIVE_HOST = BYPASS_DEDICATED ? 'gateway.pinata.cloud' : CONFIGURED_HOST;

function appendToken(url: string): string {
  // Strip any stale `pinataGatewayToken` query param off URLs routed to the
  // public gateway (the token is server-side only).
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud') && parsed.host !== ACTIVE_HOST) return url;
    if (BYPASS_DEDICATED) {
      parsed.searchParams.delete('pinataGatewayToken');
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function rewriteBrokenDedicatedGatewayUrl(url: string): string {
  if (!BYPASS_DEDICATED) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud')) return url;
    parsed.searchParams.delete('pinataGatewayToken');
    return `${PUBLIC_GATEWAY}${parsed.pathname}${parsed.search ? parsed.search : ''}`;
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

// Public fallback chain for CIDs not pinned on our Pinata account.
// Pinata dedicated gateways and gateway.pinata.cloud both 403 unpinned CIDs;
// these resolve any CID that's live on the IPFS network.
const PUBLIC_FALLBACK_GATEWAYS = ['https://w3s.link', 'https://ipfs.io', 'https://dweb.link'];

const KNOWN_GATEWAY_HOSTS = new Set<string>([
  'gateway.pinata.cloud',
  'w3s.link',
  'ipfs.io',
  'dweb.link',
  'cloudflare-ipfs.com',
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
  const candidates = getIpfsUrlCandidates(currentUrl);
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

// ── Server-signed gateway URL (WEB-1) ─────────────────────────────────────
//
// For cases where a dedicated (token-gated) Pinata gateway is required —
// typically private/token-gated content — ask the server to compose the URL.
// The gateway token stays on the server; the returned URL is short-lived.
// Successful lookups are cached in-memory per session to keep render paths
// snappy. Failures fall through to the public-gateway URL.

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export async function resolveIpfsUrlAsync(url?: string | null): Promise<string> {
  if (!url) return '';
  const parts = extractIpfsPath(url);
  if (!parts) return resolveIpfsUrl(url);

  const cacheKey = parts.cidPath.split('?')[0];
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 10_000) return cached.url;

  if (!SERVER_URL) return resolveIpfsUrl(url);

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
  }
}

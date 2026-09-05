/**
 * IPFS resolver — issues short-lived gateway URLs to clients.
 *
 * WEB-1: previously the dedicated Pinata gateway token was bundled into the
 * web app via VITE_PINATA_GATEWAY_TOKEN. Anyone could lift it from the JS
 * bundle and proxy unlimited content through our gateway. The token now
 * lives only on the server, and clients ask this endpoint to compose URLs.
 *
 * GET /api/ipfs/resolve?url=<ipfs-url-or-cid-path>
 *   Returns: { url: string, expiresAt: number }
 *   Public — no auth required (we already pay for these CIDs to be hot, and
 *   gating reads would break OG cards / unfurlers). Rate-limited per IP via
 *   the shared response cache.
 */
import { Hono } from 'hono';

const router = new Hono();

// Path-style default — fast for our CIDv0 content. A dedicated
// PINATA_GATEWAY_URL (+ token) overrides this when configured.
const PUBLIC_GATEWAY = 'https://ipfs.io';

function gatewayBase(): string {
  return (process.env.PINATA_GATEWAY_URL || PUBLIC_GATEWAY).trim().replace(/\/$/, '');
}

function gatewayHost(): string {
  try {
    return new URL(gatewayBase()).host;
  } catch {
    return '';
  }
}

function gatewayToken(): string {
  return (process.env.PINATA_GATEWAY_TOKEN || '').trim();
}

// cloudflare-ipfs.com removed 2026-08-24 — Cloudflare shut down its public
// IPFS gateway (NXDOMAIN now); see apps/web/src/utils/ipfs-url.ts.
const KNOWN_GATEWAY_HOSTS = new Set<string>([
  'gateway.pinata.cloud',
  'w3s.link',
  'ipfs.io',
  'dweb.link',
  '4everland.io',
  'nftstorage.link',
]);

function isAcceptableSourceHost(host: string): boolean {
  if (!host) return false;
  if (host.endsWith('.mypinata.cloud')) return true;
  if (host === gatewayHost()) return true;
  if (KNOWN_GATEWAY_HOSTS.has(host)) return true;
  if (host.endsWith('.ipfs.dweb.link')) return true;
  if (host.endsWith('.ipfs.w3s.link')) return true;
  return false;
}

const CID_PATH_RE = /^[A-Za-z0-9]+(?:\/[A-Za-z0-9._\-/]*)?$/;

function extractCidPath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return CID_PATH_RE.test(path) ? path : null;
  }
  // Accept bare CID or "cid/path".
  if (!trimmed.includes('://')) {
    return CID_PATH_RE.test(trimmed) ? trimmed : null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!isAcceptableSourceHost(parsed.host)) return null;

  const subdomainMatch = parsed.host.match(/^([^.]+)\.ipfs\./);
  if (subdomainMatch) {
    const cid = subdomainMatch[1];
    const rest = parsed.pathname.replace(/^\//, '');
    const cidPath = rest ? `${cid}/${rest}` : cid;
    return CID_PATH_RE.test(cidPath) ? cidPath : null;
  }
  const pathMatch = parsed.pathname.match(/^\/ipfs\/(.+)$/);
  if (pathMatch) {
    const cidPath = pathMatch[1];
    return CID_PATH_RE.test(cidPath) ? cidPath : null;
  }
  return null;
}

/**
 * GET /api/ipfs/gateway-config
 *   Returns: { base, host, token, isDedicated }
 *
 * The client primes this once per session (see apps/web/src/utils/ipfs-url.ts
 * `primeIpfsGatewayConfig`) so it can compose dedicated-gateway URLs
 * synchronously for first paint, instead of starting every asset on a slow
 * public gateway (ipfs.io) and waiting for `/api/ipfs/resolve` per CID.
 *
 * `token` is only returned for a dedicated `.mypinata.cloud` gateway that
 * actually needs it — and it is no more exposed here than it already is by
 * `/resolve`, which bakes it into every returned media URL. Not returned for
 * a public gateway config.
 */
router.get('/gateway-config', (c) => {
  const base = gatewayBase();
  const host = gatewayHost();
  const isDedicated = host.endsWith('.mypinata.cloud');
  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  return c.json({
    base,
    host,
    token: isDedicated ? gatewayToken() : '',
    isDedicated,
  });
});

router.get('/resolve', (c) => {
  const raw = c.req.query('url') ?? c.req.query('cid') ?? '';
  if (raw.length > 2048) {
    return c.json({ error: 'url too long' }, 400);
  }
  const cidPath = extractCidPath(raw);
  if (!cidPath) {
    return c.json({ error: 'invalid ipfs reference' }, 400);
  }

  const base = gatewayBase();
  const token = gatewayToken();
  const url = new URL(`${base}/ipfs/${cidPath}`);
  if (token && url.host.endsWith('.mypinata.cloud')) {
    url.searchParams.set('pinataGatewayToken', token);
  }

  // Cache at the edge for 60s; long-lived in client cache.
  c.header('Cache-Control', 'public, max-age=300, s-maxage=60');
  return c.json({
    url: url.toString(),
    expiresAt: Date.now() + 5 * 60_000,
  });
});

export const ipfsRoutes = router;

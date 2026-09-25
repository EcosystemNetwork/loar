/**
 * Shareable link previews.
 *
 * The web app is a static SPA, so social crawlers (X, Telegram, Discord, Slack)
 * only ever see the empty index.html for /tokens/:address. This route serves
 * a tiny HTML page with real Open Graph / Twitter tags for a token, then sends
 * humans on to the app via <meta refresh> (no inline script, so it works under
 * the server's strict CSP).
 *
 *   GET /share/token/:address
 *
 * Token data comes from the Ponder indexer over HTTP (`PONDER_URL`, defaults to
 * the production indexer). Every value that lands in the HTML is untrusted
 * (anyone can deploy a token with any name/image) so all of it is escaped and
 * the image URL is restricted to https.
 */
import { Hono } from 'hono';
import { getAddress } from 'viem';
import { bondingSpotPrice } from '../services/token-price';

export const shareRoutes = new Hono();

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const PONDER_URL = () => (process.env.PONDER_URL || 'https://idx.loar.fun').replace(/\/$/, '');
const APP_URL = () =>
  (
    process.env.PUBLIC_WEB_URL ||
    (process.env.CORS_ORIGIN || '').split(',')[0].trim() ||
    'https://loar.fun'
  ).replace(/\/$/, '');
const SITE = 'LOAR';

export interface ShareToken {
  id: string;
  name: string;
  symbol: string;
  imageURL?: string | null;
  metadata?: string | null;
}
export interface ShareCurve {
  ethRaised: string;
  tokensSold: string;
  graduationEth: string;
  graduated: boolean;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** https-only image URL; ipfs:// → public gateway. Anything else is dropped. */
export function shareImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (v.startsWith('ipfs://')) {
    const path = v.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return /^[A-Za-z0-9._/-]+$/.test(path) ? `https://ipfs.io/ipfs/${path}` : null;
  }
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Human description out of the token's metadata (JSON or legacy plain text). */
function metadataDescription(metadata: string | null | undefined): string {
  const raw = (metadata ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('{')) {
    try {
      const d = (JSON.parse(raw) as { description?: unknown }).description;
      return typeof d === 'string' ? d : '';
    } catch {
      return raw;
    }
  }
  return raw;
}

function compactEth(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n >= 10 ? n.toFixed(1) : n.toFixed(3);
}

/** One-line stats string: "MCap 4.000 ETH · 20% to Uniswap". Empty when untraded. */
export function shareStats(curve: ShareCurve | null): string {
  if (!curve) return '';
  if (curve.graduated) return 'Graduated to Uniswap';
  const parts: string[] = [];
  const price = bondingSpotPrice(curve.ethRaised, curve.tokensSold);
  if (price != null) {
    // Circulating supply while on the curve = tokens sold (18 decimals → whole tokens).
    const circulating = Number(BigInt(curve.tokensSold) / 10n ** 12n) / 1e6;
    parts.push(`MCap ${compactEth(price * circulating)} ETH`);
  }
  try {
    const target = BigInt(curve.graduationEth);
    if (target > 0n) {
      const pct = Number((BigInt(curve.ethRaised) * 10000n) / target) / 100;
      parts.push(`${Math.min(pct, 100).toFixed(0)}% to Uniswap`);
    }
  } catch {
    /* ignore malformed */
  }
  return parts.join(' · ');
}

export function buildSharePage(opts: {
  token: ShareToken | null;
  curve: ShareCurve | null;
  appUrl: string;
  shareUrl: string;
  appPath: string;
}): string {
  const { token, curve, appUrl, shareUrl, appPath } = opts;
  const target = `${appUrl}${appPath}`;
  const title = token
    ? `$${token.symbol} — ${token.name} | ${SITE} Launchpad`
    : `${SITE} Launchpad — story-universe tokens`;
  const desc = token
    ? [shareStats(curve), metadataDescription(token.metadata)].filter(Boolean).join(' — ') ||
      `Trade $${token.symbol} on ${SITE}. Every token is governance over a narrative universe.`
    : 'Discover universe tokens on LOAR. Every token is governance over a narrative universe.';
  const image = shareImageUrl(token?.imageURL);
  const d = desc.length > 200 ? `${desc.slice(0, 197)}…` : desc;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(d)}">`,
    `<link rel="canonical" href="${escapeHtml(target)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SITE}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(d)}">`,
    `<meta property="og:url" content="${escapeHtml(shareUrl)}">`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}">` : '',
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(d)}">`,
    image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : '',
    `<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">`,
  ].filter(Boolean);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${tags.join('')}</head><body><p><a href="${escapeHtml(target)}">Continue to ${SITE}</a></p></body></html>`;
}

async function ponder<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${PONDER_URL()}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T; errors?: unknown[] };
    return json.errors?.length ? null : (json.data ?? null);
  } catch {
    return null;
  }
}

shareRoutes.get('/token/:address', async (c) => {
  const raw = c.req.param('address');
  if (!ADDR_RE.test(raw)) return c.text('invalid address', 400);
  const checksummed = getAddress(raw); // the indexer keys tokens by checksummed id
  const app = APP_URL();
  const appPath = `/tokens/${checksummed}`;
  const shareUrl = `${new URL(c.req.url).origin}/share/token/${checksummed}`;

  const t = await ponder<{ token: ShareToken | null }>(
    `query ($id: String!) { token(id: $id) { id name symbol imageURL metadata } }`,
    { id: checksummed }
  );
  const token = t?.token ?? null;
  let curve: ShareCurve | null = null;
  if (token) {
    const cd = await ponder<{ bondingCurves: { items: ShareCurve[] } }>(
      `query ($a: String!) { bondingCurves(where: { tokenAddress: $a }, limit: 1) { items { ethRaised tokensSold graduationEth graduated } } }`,
      { a: checksummed.toLowerCase() }
    );
    curve = cd?.bondingCurves?.items?.[0] ?? null;
  }

  c.header('Cache-Control', 'public, max-age=60, s-maxage=60');
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.body(buildSharePage({ token, curve, appUrl: app, shareUrl, appPath }));
});

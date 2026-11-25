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
import { ponderQuery as ponder } from '../lib/ponder';

export const shareRoutes = new Hono();

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
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

// ── Universes ─────────────────────────────────────────────────────────────

export interface ShareUniverse {
  id: string;
  name?: string | null;
  description?: string | null;
  image_url?: string | null;
  imageURL?: string | null;
  isHidden?: boolean;
  isPrivate?: boolean;
}

/** EVM address or Solana base58 PDA — nothing that could break out of a path. */
const UNIVERSE_ID_RE = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

/** Shared OG/Twitter page: escaped tags + meta-refresh into the app. */
function ogPage(o: {
  title: string;
  description: string;
  image: string;
  target: string;
  shareUrl: string;
  ogType: string;
}): string {
  const d = o.description.length > 200 ? `${o.description.slice(0, 197)}…` : o.description;
  const tags = [
    `<title>${escapeHtml(o.title)}</title>`,
    `<meta name="description" content="${escapeHtml(d)}">`,
    `<link rel="canonical" href="${escapeHtml(o.target)}">`,
    `<meta property="og:type" content="${escapeHtml(o.ogType)}">`,
    `<meta property="og:site_name" content="${SITE}">`,
    `<meta property="og:title" content="${escapeHtml(o.title)}">`,
    `<meta property="og:description" content="${escapeHtml(d)}">`,
    `<meta property="og:url" content="${escapeHtml(o.shareUrl)}">`,
    `<meta property="og:image" content="${escapeHtml(o.image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(o.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(d)}">`,
    `<meta name="twitter:image" content="${escapeHtml(o.image)}">`,
    `<meta http-equiv="refresh" content="0;url=${escapeHtml(o.target)}">`,
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${tags.join('')}</head><body><p><a href="${escapeHtml(o.target)}">Continue to ${SITE}</a></p></body></html>`;
}

const DEFAULT_DESC = 'Create cinematic universes with AI. Own them on-chain.';

export function buildUniverseSharePage(opts: {
  universe: ShareUniverse | null;
  appUrl: string;
  shareUrl: string;
  appPath: string;
}): string {
  const { universe, appUrl, shareUrl, appPath } = opts;
  const visible = universe && !universe.isHidden && !universe.isPrivate ? universe : null;
  const name = visible?.name?.trim();
  return ogPage({
    title: name ? `${name} | ${SITE}` : `${SITE} — AI Cinematic Universe Studio`,
    description:
      visible?.description?.trim() ||
      (name ? `Watch ${name}, a cinematic universe made with AI on ${SITE}.` : DEFAULT_DESC),
    image: shareImageUrl(visible?.image_url || visible?.imageURL) || `${appUrl}/og-image.png`,
    target: `${appUrl}${appPath}`,
    shareUrl,
    ogType: 'video.tv_show',
  });
}

shareRoutes.get('/universe/:id', async (c) => {
  const id = c.req.param('id');
  if (!UNIVERSE_ID_RE.test(id)) return c.text('invalid universe id', 400);
  const app = APP_URL();
  // Watch links use the lowercased id for EVM; base58 ids keep their case.
  const pathId = id.startsWith('0x') ? id.toLowerCase() : id;
  const appPath = `/universe/${pathId}/watch`;

  let universe: ShareUniverse | null = null;
  try {
    const { getUniverse } = await import('../routers/universes/universes.handlers');
    const res = (await getUniverse(id)) as { data?: ShareUniverse };
    universe = res?.data ?? null;
  } catch {
    universe = null; // not found / Firestore hiccup → generic LOAR card, still redirects
  }

  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.body(
    buildUniverseSharePage({
      universe,
      appUrl: app,
      shareUrl: `${app}/share/universe/${pathId}`,
      appPath,
    })
  );
});

// ── Episodes ──────────────────────────────────────────────────────────────

export interface ShareEpisode {
  id: string;
  title?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
  isCanon?: boolean;
  universeId?: string | null;
}

/** Firestore auto-ids and our own slugs: no slashes, quotes or dots. */
const EPISODE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Only canon episodes in a visible universe get a real card — drafts are
 * private to their creator/collaborators (mirrors `episodes.get`), and a
 * hidden/private universe must not leak through its episodes.
 */
export function buildEpisodeSharePage(opts: {
  episode: ShareEpisode | null;
  universe: ShareUniverse | null;
  appUrl: string;
  shareUrl: string;
  appPath: string;
}): string {
  const { episode, universe, appUrl, shareUrl, appPath } = opts;
  const uVisible = universe && !universe.isHidden && !universe.isPrivate ? universe : null;
  const ep = episode?.isCanon && uVisible ? episode : null;
  const title = ep?.title?.trim();
  const uName = uVisible?.name?.trim();
  return ogPage({
    title: title
      ? `${title}${uName ? ` — ${uName}` : ''} | ${SITE}`
      : `${SITE} — AI Cinematic Universe Studio`,
    description:
      ep?.description?.trim() ||
      (title ? `Watch “${title}”${uName ? ` from ${uName}` : ''} on ${SITE}.` : DEFAULT_DESC),
    image:
      shareImageUrl(ep?.thumbnailUrl) ||
      (ep ? shareImageUrl(uVisible?.image_url || uVisible?.imageURL) : null) ||
      `${appUrl}/og-image.png`,
    target: `${appUrl}${appPath}`,
    shareUrl,
    ogType: 'video.episode',
  });
}

shareRoutes.get('/episode/:id', async (c) => {
  const id = c.req.param('id');
  if (!EPISODE_ID_RE.test(id)) return c.text('invalid episode id', 400);
  const app = APP_URL();

  let episode: ShareEpisode | null = null;
  let universe: ShareUniverse | null = null;
  try {
    const { db } = await import('../lib/firebase');
    const snap = await db.collection('episodes').doc(id).get();
    episode = snap.exists ? ({ id, ...(snap.data() as object) } as ShareEpisode) : null;
    if (episode?.isCanon && episode.universeId) {
      const { getUniverse } = await import('../routers/universes/universes.handlers');
      const res = (await getUniverse(episode.universeId)) as { data?: ShareUniverse };
      universe = res?.data ?? null;
    }
  } catch {
    episode = null; // Firestore hiccup → generic card, still redirects
  }

  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.body(
    buildEpisodeSharePage({
      episode,
      universe,
      appUrl: app,
      shareUrl: `${app}/share/episode/${id}`,
      appPath: `/episode/${id}`,
    })
  );
});

// ── Sitemap of public universes ───────────────────────────────────────────
// Served at loar.fun/share/sitemap-universes.xml via the Netlify /share/*
// proxy (robots.txt lists it), so every public universe's watch page is
// discoverable — the static sitemap.xml only covers fixed routes.

export function buildUniverseSitemap(
  appUrl: string,
  universes: Array<{ id: string; isHidden?: boolean; isPrivate?: boolean; updatedAt?: unknown }>
): string {
  const urls = universes
    .filter((u) => u.id && !u.isHidden && !u.isPrivate && UNIVERSE_ID_RE.test(u.id))
    .map((u) => {
      const pathId = u.id.startsWith('0x') ? u.id.toLowerCase() : u.id;
      return `<url><loc>${escapeHtml(`${appUrl}/universe/${pathId}/watch`)}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
}

shareRoutes.get('/sitemap-universes.xml', async (c) => {
  let universes: Array<{ id: string; isHidden?: boolean; isPrivate?: boolean }> = [];
  try {
    const { getAllUniverses } = await import('../routers/universes/universes.handlers');
    const res = (await getAllUniverses()) as unknown;
    const list = (res as { data?: unknown })?.data ?? res;
    universes = Array.isArray(list) ? (list as typeof universes) : [];
  } catch {
    universes = [];
  }
  c.header('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  c.header('Content-Type', 'application/xml; charset=utf-8');
  return c.body(buildUniverseSitemap(APP_URL(), universes));
});

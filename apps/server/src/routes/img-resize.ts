/**
 * Image proxy — returns a resized, format-negotiated rendition of an IPFS
 * image. Used by the web app's srcset to avoid shipping full-resolution
 * originals to every viewport.
 *
 * GET /api/img?url=<gateway-url>&w=<width>&format=auto|webp|avif|jpeg
 *
 * SSRF-safe: only honors URLs that resolve to a recognized IPFS gateway host.
 *
 * Two paths, in priority order:
 *  1. DELEGATE (production): when a dedicated Pinata gateway + token is
 *     configured (PINATA_GATEWAY_URL on *.mypinata.cloud), the resize is done
 *     by Pinata's CDN-side image optimization (img-width/img-format) and the
 *     bytes are streamed through. No origin CPU, no per-instance cache —
 *     Pinata's Cloudflare edge caches the rendition globally. The token stays
 *     server-side. This is the horizontally-scalable path; front /api/img with
 *     a CDN and the origin is barely touched.
 *  2. FALLBACK: no dedicated gateway (dev) or Pinata optimization unavailable
 *     → fetch the original and resize with sharp on the origin. Concurrency-
 *     capped (IMG_MAX_CONCURRENT_TRANSCODES) and cached in-memory + on disk
 *     (IMG_CACHE_DIR) so the cost is paid once per CID and survives restarts.
 *
 * All responses are immutable + `Vary: Accept` so any fronting CDN can cache
 * them safely per content-negotiated format.
 */
import { Hono } from 'hono';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const router = new Hono();

const ALLOWED_WIDTHS = [160, 240, 320, 480, 640, 960, 1280, 1600, 1920];
const MAX_SOURCE_BYTES = 30 * 1024 * 1024; // 30MB upper bound on the input
const FETCH_TIMEOUT_MS = 10_000;

// cloudflare-ipfs.com removed 2026-08-24 — Cloudflare shut down its public
// IPFS gateway (NXDOMAIN now); see apps/web/src/utils/ipfs-url.ts. (That fix,
// af79f79d, missed this file — fixed here to match.)
const KNOWN_GATEWAY_HOSTS = new Set<string>([
  'gateway.pinata.cloud',
  'w3s.link',
  'ipfs.io',
  'dweb.link',
  '4everland.io',
  'nftstorage.link',
]);

// Default upstream for the proxy fetch. ipfs.io is path-style and serves our
// CIDv0 content fast; gateway.pinata.cloud is rate-limited/slow unauthenticated
// and subdomain gateways stall on CIDv0 (see apps/web ipfs-url.ts). When a
// dedicated PINATA_GATEWAY_URL + token are configured, that takes precedence.
const PUBLIC_GATEWAY = 'https://ipfs.io';

function gatewayBase(): string {
  return (process.env.PINATA_GATEWAY_URL || PUBLIC_GATEWAY).trim().replace(/\/$/, '');
}

function gatewayToken(): string {
  return (process.env.PINATA_GATEWAY_TOKEN || '').trim();
}

function isAcceptableSourceUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (KNOWN_GATEWAY_HOSTS.has(u.host)) return true;
    if (u.host.endsWith('.mypinata.cloud')) return true;
    if (u.host.endsWith('.ipfs.dweb.link')) return true;
    if (u.host.endsWith('.ipfs.w3s.link')) return true;
    return false;
  } catch {
    return false;
  }
}

// Pull the "<cid>[/sub/path]" portion out of any recognized gateway URL so we
// can re-point the fetch at our fast dedicated gateway.
function extractCidPath(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const subdomainMatch = parsed.host.match(/^([^.]+)\.ipfs\./);
  if (subdomainMatch) {
    const cid = subdomainMatch[1];
    const rest = parsed.pathname.replace(/^\//, '');
    return rest ? `${cid}/${rest}` : cid;
  }
  const pathMatch = parsed.pathname.match(/^\/ipfs\/(.+)$/);
  if (pathMatch) return pathMatch[1];
  return null;
}

// Given the (already SSRF-validated) client URL, return the URL we actually
// fetch upstream: our dedicated gateway + token when the CID is recoverable,
// otherwise the original URL unchanged.
function upstreamFetchUrl(raw: string): string {
  const cidPath = extractCidPath(raw);
  if (!cidPath) return raw;
  const base = gatewayBase();
  let url: URL;
  try {
    url = new URL(`${base}/ipfs/${cidPath}`);
  } catch {
    return raw;
  }
  const token = gatewayToken();
  if (token && url.host.endsWith('.mypinata.cloud')) {
    url.searchParams.set('pinataGatewayToken', token);
  }
  return url.toString();
}

// Build the dedicated-gateway URL with Pinata's CDN-side image-optimization
// params so the resize happens on Pinata's (Cloudflare-backed) edge instead of
// our origin. Returns null when the upstream isn't a dedicated `.mypinata.cloud`
// gateway (then we fall back to origin-side sharp).
// Pinata supports img-format=avif|webp; for jpeg/png we omit it and just resize
// (keeping the source format), and img-fit=scale-down never upscales.
function pinataOptimizedUrl(upstream: string, width: number, format: OutputFormat): string | null {
  let url: URL;
  try {
    url = new URL(upstream);
  } catch {
    return null;
  }
  if (!url.host.endsWith('.mypinata.cloud')) return null;
  url.searchParams.set('img-width', String(width));
  url.searchParams.set('img-fit', 'scale-down');
  if (format === 'avif' || format === 'webp') url.searchParams.set('img-format', format);
  return url.toString();
}

// ── Origin transcode concurrency gate ─────────────────────────────────────
// Only the sharp FALLBACK path uses this (the Pinata path does no origin CPU
// work). sharp transcodes are CPU + memory heavy; an unbounded burst under a
// traffic spike can pin the event loop and OOM the container. Cap concurrent
// transcodes and queue the rest. Slots are handed directly to the next waiter
// so the in-flight count never drifts.
const MAX_CONCURRENT_TRANSCODES = Math.max(
  1,
  Number(process.env.IMG_MAX_CONCURRENT_TRANSCODES) || 4
);
let activeTranscodes = 0;
const transcodeWaiters: Array<() => void> = [];

async function acquireTranscodeSlot(): Promise<void> {
  if (activeTranscodes < MAX_CONCURRENT_TRANSCODES) {
    activeTranscodes++;
    return;
  }
  await new Promise<void>((resolve) => transcodeWaiters.push(resolve));
  // Slot was handed to us by releaseTranscodeSlot without decrementing, so the
  // owned-slot count is already correct — don't increment again.
}

function releaseTranscodeSlot(): void {
  const next = transcodeWaiters.shift();
  if (next) next();
  else activeTranscodes--;
}

function pickWidth(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 640;
  // Snap to the nearest allowed width to keep cache keys tight.
  let best = ALLOWED_WIDTHS[0];
  let bestDiff = Math.abs(n - best);
  for (const w of ALLOWED_WIDTHS) {
    const d = Math.abs(n - w);
    if (d < bestDiff) {
      best = w;
      bestDiff = d;
    }
  }
  return best;
}

type OutputFormat = 'webp' | 'avif' | 'jpeg' | 'png';

function pickFormat(req: {
  query: (key: string) => string | undefined;
  header: (k: string) => string | undefined;
}): OutputFormat {
  const explicit = (req.query('format') || 'auto').toLowerCase();
  if (explicit === 'webp' || explicit === 'avif' || explicit === 'jpeg' || explicit === 'png') {
    return explicit;
  }
  const accept = req.header('accept') || '';
  if (accept.includes('image/avif')) return 'avif';
  if (accept.includes('image/webp')) return 'webp';
  return 'jpeg';
}

// Tiny LRU keyed on `${url}|${w}|${fmt}`. Memory-only; survives only the
// process. Keep bounded so a flood of unique requests can't blow heap.
const CACHE_MAX_ENTRIES = 256;
const CACHE_MAX_BYTES = 256 * 1024 * 1024; // 256MB ceiling
type CacheEntry = { body: Buffer; contentType: string; insertedAt: number };
const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;

function cacheGet(key: string): CacheEntry | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  // LRU bump
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cachePut(key: string, body: Buffer, contentType: string) {
  cache.set(key, { body, contentType, insertedAt: Date.now() });
  cacheBytes += body.length;
  while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
    const first = cache.keys().next().value;
    if (!first) break;
    const evicted = cache.get(first);
    cache.delete(first);
    if (evicted) cacheBytes -= evicted.body.length;
  }
}

// ── Disk cache ────────────────────────────────────────────────────────────
// Renditions are content-addressed by `url|w|format`, so they're safe to
// persist. The in-memory LRU above is the hot tier (256MB, dies on restart);
// disk is the durable tier so the slow first IPFS fetch survives deploys.
// Disabled by setting IMG_CACHE_DIR="" (or "off") for ephemeral hosts.
const DISK_CACHE_DIR = (() => {
  const raw = process.env.IMG_CACHE_DIR;
  if (raw === '' || raw?.toLowerCase() === 'off') return null;
  return raw?.trim() || path.join(os.tmpdir(), 'loar-img-cache');
})();

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/avif': 'avif',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
};

let diskCacheReady: Promise<boolean> | null = null;
function ensureDiskCache(): Promise<boolean> {
  if (!DISK_CACHE_DIR) return Promise.resolve(false);
  if (!diskCacheReady) {
    diskCacheReady = fs
      .mkdir(DISK_CACHE_DIR, { recursive: true })
      .then(() => true)
      .catch(() => false);
  }
  return diskCacheReady;
}

function diskPathFor(key: string, contentType: string): string {
  const hash = createHash('sha256').update(key).digest('hex');
  const ext = EXT_BY_CONTENT_TYPE[contentType] || 'bin';
  return path.join(DISK_CACHE_DIR as string, `${hash}.${ext}`);
}

async function diskGet(key: string): Promise<CacheEntry | undefined> {
  if (!(await ensureDiskCache())) return undefined;
  const hash = createHash('sha256').update(key).digest('hex');
  for (const ext of Object.keys(CONTENT_TYPE_BY_EXT)) {
    try {
      const body = await fs.readFile(path.join(DISK_CACHE_DIR as string, `${hash}.${ext}`));
      return { body, contentType: CONTENT_TYPE_BY_EXT[ext], insertedAt: 0 };
    } catch {
      /* miss — try next ext */
    }
  }
  return undefined;
}

async function diskPut(key: string, body: Buffer, contentType: string): Promise<void> {
  if (!(await ensureDiskCache())) return;
  const file = diskPathFor(key, contentType);
  try {
    // Write to a temp file then rename so concurrent readers never see a
    // partial rendition.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, file);
  } catch {
    /* disk full / read-only fs — degrade to memory-only silently */
  }
}

router.get('/', async (c) => {
  const rawUrl = c.req.query('url') || '';
  if (!rawUrl || rawUrl.length > 2048) return c.json({ error: 'invalid url' }, 400);
  if (!isAcceptableSourceUrl(rawUrl)) return c.json({ error: 'host not allowed' }, 400);

  const width = pickWidth(c.req.query('w'));
  const format = pickFormat({
    query: (k) => c.req.query(k),
    header: (k) => c.req.header(k),
  });

  const upstreamUrl = upstreamFetchUrl(rawUrl);

  // ── Production path: delegate the resize to the dedicated gateway's CDN ──
  // Pinata performs the resize + format negotiation on its Cloudflare edge and
  // caches the rendition globally (cf-cache HIT), so the origin does ZERO image
  // CPU and holds no per-instance cache. We just stream the bytes through with
  // the token kept server-side. This is what makes /api/img horizontally
  // scalable — front it with a CDN and the origin is barely touched. Falls
  // through to origin-side sharp on any non-2xx / network error.
  const optimizedUrl = pinataOptimizedUrl(upstreamUrl, width, format);
  if (optimizedUrl) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const accept = c.req.header('accept');
      const upstream = await fetch(optimizedUrl, {
        signal: ctrl.signal,
        headers: accept ? { accept } : undefined,
      });
      clearTimeout(t);
      if (upstream.ok && upstream.body) {
        c.header('Content-Type', upstream.headers.get('content-type') || `image/${format}`);
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
        c.header('Vary', 'Accept');
        c.header('X-Img-Cache', 'pinata');
        return c.body(upstream.body);
      }
      // Non-2xx (e.g. optimization unavailable for this asset) → sharp fallback.
    } catch {
      clearTimeout(t);
      // Network/timeout → sharp fallback.
    }
  }

  // ── Fallback path: origin-side sharp transcode (no dedicated gateway, or
  // Pinata optimization unavailable). Cached in-memory + on disk and rate-
  // limited via the transcode gate. Cache key is the CID-normalized path (sans
  // token) so the same CID via different gateways shares one rendition.
  const cidPath = extractCidPath(rawUrl) ?? rawUrl;
  const cacheKey = `${cidPath}|${width}|${format}`;

  const hit = cacheGet(cacheKey);
  if (hit) {
    c.header('Content-Type', hit.contentType);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    c.header('Vary', 'Accept');
    c.header('X-Img-Cache', 'hit');
    return c.body(new Uint8Array(hit.body));
  }

  const onDisk = await diskGet(cacheKey);
  if (onDisk) {
    cachePut(cacheKey, onDisk.body, onDisk.contentType);
    c.header('Content-Type', onDisk.contentType);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    c.header('Vary', 'Accept');
    c.header('X-Img-Cache', 'disk');
    return c.body(new Uint8Array(onDisk.body));
  }

  let sourceBuffer: Buffer;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(upstreamUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return c.json({ error: 'upstream error', status: res.status }, 502);
    const lenHeader = Number(res.headers.get('content-length') || 0);
    if (lenHeader && lenHeader > MAX_SOURCE_BYTES) {
      return c.json({ error: 'source too large' }, 413);
    }
    const arr = await res.arrayBuffer();
    if (arr.byteLength > MAX_SOURCE_BYTES) {
      return c.json({ error: 'source too large' }, 413);
    }
    sourceBuffer = Buffer.from(arr);
  } catch (err) {
    clearTimeout(timeout);
    return c.json({ error: 'fetch failed', message: (err as Error).message }, 502);
  }

  let pipeline = sharp(sourceBuffer, { failOn: 'truncated' }).rotate().resize({
    width,
    withoutEnlargement: true,
    fit: 'inside',
  });

  let contentType = 'image/jpeg';
  if (format === 'avif') {
    pipeline = pipeline.avif({ quality: 60, effort: 4 });
    contentType = 'image/avif';
  } else if (format === 'webp') {
    pipeline = pipeline.webp({ quality: 78 });
    contentType = 'image/webp';
  } else if (format === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9 });
    contentType = 'image/png';
  } else {
    pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
    contentType = 'image/jpeg';
  }

  let output: Buffer;
  await acquireTranscodeSlot();
  try {
    output = await pipeline.toBuffer();
  } catch (err) {
    return c.json({ error: 'transcode failed', message: (err as Error).message }, 500);
  } finally {
    releaseTranscodeSlot();
  }

  cachePut(cacheKey, output, contentType);
  void diskPut(cacheKey, output, contentType);
  c.header('Content-Type', contentType);
  // Image renditions are content-addressed by `url|w|format`; safe to cache forever.
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  c.header('Vary', 'Accept');
  c.header('X-Img-Cache', 'miss');
  return c.body(new Uint8Array(output));
});

export const imgResizeRoutes = router;

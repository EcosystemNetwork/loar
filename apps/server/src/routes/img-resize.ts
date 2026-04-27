/**
 * Image resize proxy — fetches an image from a known IPFS gateway, resizes
 * with sharp, and serves it with content negotiation (webp/avif when the
 * client supports it). Used by SmartImage's srcset to avoid downloading
 * full-resolution originals on every viewport.
 *
 * GET /api/img?url=<gateway-url>&w=<width>&format=auto|webp|avif|jpeg
 *
 * SSRF-safe: only honors URLs that resolve to a recognized IPFS gateway host.
 * Anything else is rejected with 400.
 */
import { Hono } from 'hono';
import sharp from 'sharp';

const router = new Hono();

const ALLOWED_WIDTHS = [160, 240, 320, 480, 640, 960, 1280, 1600, 1920];
const MAX_SOURCE_BYTES = 30 * 1024 * 1024; // 30MB upper bound on the input
const FETCH_TIMEOUT_MS = 10_000;

const KNOWN_GATEWAY_HOSTS = new Set<string>([
  'gateway.pinata.cloud',
  'w3s.link',
  'ipfs.io',
  'dweb.link',
  'cloudflare-ipfs.com',
  '4everland.io',
  'nftstorage.link',
]);

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

router.get('/', async (c) => {
  const rawUrl = c.req.query('url') || '';
  if (!rawUrl || rawUrl.length > 2048) return c.json({ error: 'invalid url' }, 400);
  if (!isAcceptableSourceUrl(rawUrl)) return c.json({ error: 'host not allowed' }, 400);

  const width = pickWidth(c.req.query('w'));
  const format = pickFormat({
    query: (k) => c.req.query(k),
    header: (k) => c.req.header(k),
  });

  const cacheKey = `${rawUrl}|${width}|${format}`;
  const hit = cacheGet(cacheKey);
  if (hit) {
    c.header('Content-Type', hit.contentType);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    c.header('X-Img-Cache', 'hit');
    return c.body(new Uint8Array(hit.body));
  }

  let sourceBuffer: Buffer;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(rawUrl, { signal: controller.signal });
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
  try {
    output = await pipeline.toBuffer();
  } catch (err) {
    return c.json({ error: 'transcode failed', message: (err as Error).message }, 500);
  }

  cachePut(cacheKey, output, contentType);
  c.header('Content-Type', contentType);
  // Image renditions are content-addressed by `url|w|format`; safe to cache forever.
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  c.header('Vary', 'Accept');
  c.header('X-Img-Cache', 'miss');
  return c.body(new Uint8Array(output));
});

export const imgResizeRoutes = router;

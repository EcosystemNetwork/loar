/**
 * Model3DThumbnail — client-side "screenshot" fallback for 3D cards.
 *
 * Most `mediaType: '3d'` gallery items have no `thumbnailUrl` (Meshy/Tripo
 * previews were expiring URLs that were never rehosted), so their cards fall
 * back to a bare cube glyph. This component renders the GLB offscreen in a
 * throwaway <model-viewer>, captures the first painted frame with the
 * element's `toDataURL()` API, and shows that PNG as the thumbnail.
 *
 * The capture is cached in-memory (per session) and in `localStorage` keyed
 * by the model URL, so a given model is only ever rendered once per browser.
 * While the capture is in flight — or if it fails (dead gateway, tainted
 * canvas from a no-CORS gateway, parse error) — `fallback` is shown.
 *
 * Only use this where <model-viewer> is already on the page's bundle
 * (Discover, Wiki); importing it elsewhere pulls in ~1MB of viewer code.
 */
import '@google/model-viewer';
import { useEffect, useState } from 'react';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';

interface Model3DThumbnailProps {
  /** URL to the GLB/GLTF model (ipfs:// or an already-resolved gateway URL). */
  src: string;
  alt?: string;
  className?: string;
  /** Shown while capturing and if capture fails. */
  fallback: React.ReactNode;
}

const LS_KEY = 'm3dthumb:v1';
const LS_MAX_ENTRIES = 40;
const CAPTURE_SIZE = 384;
const LOAD_TIMEOUT_MS = 20_000;
// Browsers hard-cap live WebGL contexts (~16) and drop the oldest past that,
// so a full 3D grid mounting at once would knock out its own earlier renders.
// Cap how many <model-viewer> captures run concurrently and queue the rest.
const MAX_CONCURRENT = 3;

const memCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

let activeCount = 0;
const waiters: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((res) => waiters.push(res)).then(() => {
    activeCount++;
  });
}

function releaseSlot() {
  activeCount = Math.max(0, activeCount - 1);
  waiters.shift()?.();
}

function lsRead(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function lsWrite(map: Record<string, string>) {
  try {
    let entries = Object.entries(map);
    // Object insertion order ≈ recency; drop the oldest past the cap so a
    // long browsing session can't blow the ~5MB localStorage quota.
    if (entries.length > LS_MAX_ENTRIES) entries = entries.slice(-LS_MAX_ENTRIES);
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* quota / private mode — in-memory cache still applies for this session */
  }
}

function cacheGet(src: string): string | null {
  const hit = memCache.get(src);
  if (hit) return hit;
  const stored = lsRead()[src];
  if (stored) {
    memCache.set(src, stored);
    return stored;
  }
  return null;
}

function cacheSet(src: string, dataUrl: string) {
  memCache.set(src, dataUrl);
  const map = lsRead();
  delete map[src]; // re-insert at the end so it counts as most-recent
  map[src] = dataUrl;
  lsWrite(map);
}

/**
 * Render `src` in a detached <model-viewer>, wait for the model to paint, and
 * return a data-URL screenshot of the first frame. Resolves `null` on any
 * failure — callers fall back to a glyph.
 */
function captureThumbnail(src: string): Promise<string | null> {
  const cached = cacheGet(src);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(src);
  if (existing) return existing;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  const render = () =>
    new Promise<string | null>((resolve) => {
      // <model-viewer> only drives its render loop while it intersects the
      // viewport, so the host has to sit *on* screen — just made invisible
      // and un-hittable — rather than parked at a negative offset.
      const host = document.createElement('div');
      host.style.cssText = [
        'position:fixed',
        'left:0',
        'top:0',
        `width:${CAPTURE_SIZE}px`,
        `height:${CAPTURE_SIZE}px`,
        'opacity:0',
        'pointer-events:none',
        'z-index:-1',
        'overflow:hidden',
      ].join(';');

      const el = document.createElement('model-viewer') as any;
      el.setAttribute('src', resolveIpfsUrlPreferred(src));
      el.setAttribute('reveal', 'auto');
      el.setAttribute('loading', 'eager');
      el.setAttribute('environment-image', 'neutral');
      el.setAttribute('shadow-intensity', '0');
      el.setAttribute('tone-mapping', 'neutral');
      el.setAttribute('exposure', '1');
      el.setAttribute('interaction-prompt', 'none');
      el.setAttribute('disable-zoom', '');
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.backgroundColor = 'transparent';

      let settled = false;
      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          el.remove();
          host.remove();
        } catch {
          /* already detached */
        }
        if (result) cacheSet(src, result);
        resolve(result);
      };

      const timer = setTimeout(() => finish(null), LOAD_TIMEOUT_MS);

      el.addEventListener('load', () => {
        // `load` fires when the GLB is parsed; give the renderer a couple of
        // frames to actually paint before reading the canvas back.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try {
              const dataUrl: string =
                typeof el.toDataURL === 'function' ? el.toDataURL('image/png') : '';
              // A tainted canvas (no-CORS gateway) throws above; a blank
              // frame comes back as a tiny string — treat both as failure.
              finish(dataUrl && dataUrl.length > 512 ? dataUrl : null);
            } catch {
              finish(null);
            }
          });
        });
      });
      el.addEventListener('error', () => finish(null));

      host.appendChild(el);
      document.body.appendChild(host);
    });

  const job = acquireSlot()
    .then(render)
    .then(
      (result) => {
        releaseSlot();
        inFlight.delete(src);
        return result;
      },
      () => {
        releaseSlot();
        inFlight.delete(src);
        return null;
      }
    );

  inFlight.set(src, job);
  return job;
}

export function Model3DThumbnail({
  src,
  alt = '3D model',
  className,
  fallback,
}: Model3DThumbnailProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(() => (src ? cacheGet(src) : null));

  useEffect(() => {
    if (!src) return;
    const hit = cacheGet(src);
    if (hit) {
      setDataUrl(hit);
      return;
    }
    let alive = true;
    setDataUrl(null);
    captureThumbnail(src).then((url) => {
      if (alive && url) setDataUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  if (!dataUrl) return <>{fallback}</>;
  return <img src={dataUrl} alt={alt} className={className} loading="lazy" />;
}

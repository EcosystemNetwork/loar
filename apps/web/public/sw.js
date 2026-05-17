/**
 * LOAR offline-video service worker.
 *
 * Scope: caches user-flagged video files so an episode they "saved offline"
 *        keeps playing while the network is gone. Does NOT cache app shell
 *        (TanStack Router + Vite handle that). DRM-protected content is not
 *        supported — LOAR currently has none, but if/when it does this
 *        worker must skip those URLs.
 *
 * Message protocol (client → SW via postMessage):
 *   { type: 'CACHE_VIDEO',   url: string, episodeId: string }
 *   { type: 'UNCACHE_VIDEO', url: string, episodeId: string }
 *   { type: 'LIST_CACHED' }   →   sw.postMessage({ type: 'CACHED', urls: [...] })
 *
 * Fetch strategy:
 *   - For URLs present in the offline cache: cache-first, network fallback.
 *   - For all other requests: passthrough (default browser behaviour).
 */

const CACHE_NAME = 'loar-offline-videos-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreVary: true, ignoreSearch: false });
      if (cached) {
        // Cache-first: serve immediately, optionally revalidate in background.
        return cached;
      }
      try {
        return await fetch(req);
      } catch (err) {
        // Network gone AND not in cache — return a synthetic 504 so the
        // player surfaces an offline state instead of hanging.
        return new Response('offline', { status: 504, statusText: 'offline' });
      }
    })()
  );
});

async function cacheVideo(url) {
  const cache = await caches.open(CACHE_NAME);
  // Skip if already cached — re-fetching wastes bandwidth.
  const existing = await cache.match(url);
  if (existing) return { ok: true, alreadyCached: true };
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return { ok: false, status: res.status };
    await cache.put(url, res.clone());
    return { ok: true, alreadyCached: false };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

async function uncacheVideo(url) {
  const cache = await caches.open(CACHE_NAME);
  const deleted = await cache.delete(url);
  return { ok: deleted };
}

async function listCached() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  return keys.map((req) => req.url);
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];
  const reply = (msg) => {
    if (port) port.postMessage(msg);
    else if (event.source && event.source.postMessage) event.source.postMessage(msg);
  };

  if (data.type === 'CACHE_VIDEO' && data.url) {
    event.waitUntil(
      cacheVideo(data.url).then((res) =>
        reply({ type: 'CACHE_VIDEO_RESULT', url: data.url, episodeId: data.episodeId, ...res })
      )
    );
  } else if (data.type === 'UNCACHE_VIDEO' && data.url) {
    event.waitUntil(
      uncacheVideo(data.url).then((res) =>
        reply({ type: 'UNCACHE_VIDEO_RESULT', url: data.url, episodeId: data.episodeId, ...res })
      )
    );
  } else if (data.type === 'LIST_CACHED') {
    event.waitUntil(listCached().then((urls) => reply({ type: 'CACHED', urls })));
  }
});

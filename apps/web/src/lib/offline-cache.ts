/**
 * Offline cache client — wraps the service worker message protocol and
 * tracks an IndexedDB mapping of episodeId → cached URLs so the UI can
 * show "Saved offline" without hitting the SW for every render.
 *
 * The service worker (`/sw.js`) owns the actual Cache Storage entries.
 * This module is a thin client: it posts messages to the SW for cache
 * mutations and updates the local IndexedDB index for fast queries.
 *
 * IndexedDB shape:
 *   db `loar-offline` v1
 *     objectStore `episodes`  keyPath: 'episodeId'
 *       { episodeId, urls: string[], savedAt: number, title?: string }
 */

const DB_NAME = 'loar-offline';
const DB_VERSION = 1;
const STORE = 'episodes';

export interface SavedEpisode {
  episodeId: string;
  urls: string[];
  savedAt: number;
  title?: string;
}

/** Open (or upgrade) the local index DB. Idempotent. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'episodeId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

async function getController(): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.active ?? reg.installing ?? reg.waiting;
}

function postWithReply<T = unknown>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    getController().then((sw) => {
      if (!sw) {
        reject(new Error('Service worker not active'));
        return;
      }
      const channel = new MessageChannel();
      const timer = setTimeout(() => reject(new Error('SW reply timed out')), 30_000);
      channel.port1.onmessage = (ev) => {
        clearTimeout(timer);
        resolve(ev.data as T);
      };
      sw.postMessage(message, [channel.port2]);
    });
  });
}

/** True if the runtime supports the offline-save feature. */
export function offlineSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'caches' in window &&
    'indexedDB' in window
  );
}

/**
 * One-time service-worker registration. Call from app boot. No-op if SW
 * is already registered or the browser doesn't support it.
 */
export async function registerOfflineWorker(): Promise<void> {
  if (!offlineSupported()) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('[offline] SW registration failed:', err);
  }
}

export async function saveEpisode(input: {
  episodeId: string;
  urls: string[];
  title?: string;
}): Promise<{ ok: boolean; errors: string[] }> {
  if (!offlineSupported()) return { ok: false, errors: ['offline cache unsupported'] };
  const errors: string[] = [];
  for (const url of input.urls) {
    try {
      const res = await postWithReply<{ ok: boolean; status?: number; error?: string }>({
        type: 'CACHE_VIDEO',
        url,
        episodeId: input.episodeId,
      });
      if (!res.ok) {
        errors.push(`${url}: ${res.error ?? `status ${res.status ?? '?'}`}`);
      }
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
  await tx('readwrite', (store) =>
    store.put({
      episodeId: input.episodeId,
      urls: input.urls,
      savedAt: Date.now(),
      title: input.title,
    })
  );
  return { ok: errors.length === 0, errors };
}

export async function removeEpisode(episodeId: string): Promise<void> {
  if (!offlineSupported()) return;
  const entry = await tx<SavedEpisode | undefined>(
    'readonly',
    (store) => store.get(episodeId) as IDBRequest<SavedEpisode | undefined>
  );
  if (entry) {
    for (const url of entry.urls) {
      try {
        await postWithReply({ type: 'UNCACHE_VIDEO', url, episodeId });
      } catch {
        /* best effort */
      }
    }
  }
  await tx('readwrite', (store) => store.delete(episodeId));
}

export async function isSaved(episodeId: string): Promise<boolean> {
  if (!offlineSupported()) return false;
  const entry = await tx<SavedEpisode | undefined>(
    'readonly',
    (store) => store.get(episodeId) as IDBRequest<SavedEpisode | undefined>
  );
  return !!entry;
}

export async function listSavedEpisodes(): Promise<SavedEpisode[]> {
  if (!offlineSupported()) return [];
  return tx<SavedEpisode[]>('readonly', (store) => store.getAll() as IDBRequest<SavedEpisode[]>);
}

import { useEffect, useMemo, useState } from 'react';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';
import type { DurationMap } from '@/lib/timelineEdit';

// Shared across mounts: a clip's source length never changes, and re-probing
// every remount would re-download metadata for the whole episode.
const durationCache = new Map<string, number>();
const inflight = new Map<string, Promise<number | null>>();

function probeDuration(url: string): Promise<number | null> {
  const pending = inflight.get(url);
  if (pending) return pending;

  const p = new Promise<number | null>((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const done = (value: number | null) => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => done(null);
    video.src = resolveIpfsUrlPreferred(url);
  }).finally(() => inflight.delete(url));

  inflight.set(url, p);
  return p;
}

/**
 * Real source durations (seconds) for a set of clip URLs, read from the media
 * files' metadata. The editor needs these to split / trim against the true end
 * of a clip — the stored `trimEnd: 0` only means "the whole file".
 *
 * `pending` is true until every URL has either resolved or failed, so callers
 * can hold off on edits that would otherwise clamp against a placeholder length.
 */
export function useClipDurations(urls: string[]): { durations: DurationMap; pending: boolean } {
  const [durations, setDurations] = useState<DurationMap>({});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const unique = useMemo(() => [...new Set(urls.filter(Boolean))], [urls.join('\n')]);

  useEffect(() => {
    let cancelled = false;
    for (const url of unique) {
      const cached = durationCache.get(url);
      if (cached) {
        setDurations((d) => (d[url] === cached ? d : { ...d, [url]: cached }));
        continue;
      }
      probeDuration(url).then((value) => {
        if (cancelled) return;
        if (value) {
          durationCache.set(url, value);
          setDurations((d) => ({ ...d, [url]: value }));
        } else {
          setFailed((f) => new Set(f).add(url));
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [unique]);

  // Judged from state alone (not the cache) so `durations` and `pending` always agree.
  const pending = unique.some((u) => !durations[u] && !failed.has(u));
  return { durations, pending };
}

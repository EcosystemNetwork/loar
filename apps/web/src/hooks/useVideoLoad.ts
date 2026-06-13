/**
 * useVideoLoad — Gates a video's src through the shared load queue and
 * defers loading until the element scrolls near the viewport.
 *
 * Usage:
 *   const { videoRef, ready, onLoaded } = useVideoLoad(src);
 *   <video ref={videoRef} src={ready ? src : undefined} onLoadedData={onLoaded} ... />
 *
 * Flow:
 *   1. The video element mounts with no src — only its <poster> renders.
 *   2. An IntersectionObserver waits until the card is within 300px of the
 *      viewport, then asks the shared queue for a loading slot.
 *   3. Once granted, `ready` flips to true so the caller can set the src.
 *   4. The caller MUST invoke `onLoaded` on `onLoadedData` / `onError` so the
 *      slot is released for the next visible card.
 *
 * This keeps the network sane while still loading every visible video — the
 * old FIFO-only version would leave off-screen cards loading first and the
 * visible row staggered.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { videoLoadQueue } from '@/lib/videoLoadQueue';

// If a video reports neither `loadeddata` nor `error` within this window — common
// over a slow/flaky IPFS gateway where the element just hangs — we release its
// queue slot anyway. Otherwise a few stuck videos hold all the slots and the
// rest of the grid never gets to load at all ("not all videos load").
const SLOT_WATCHDOG_MS = 8000;

export function useVideoLoad(src: string | undefined) {
  const id = useId();
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const slotAcquired = useRef(false);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!src) return;
    const node = videoRef.current;
    if (!node) return;

    let cancelled = false;
    let enqueued = false;

    const startLoading = () => {
      if (enqueued) return;
      enqueued = true;
      videoLoadQueue.enqueue(id).then(() => {
        if (cancelled) {
          videoLoadQueue.done(id);
          return;
        }
        slotAcquired.current = true;
        setReady(true);
        // Watchdog — hand the slot back if the video hasn't loaded in time. The
        // src stays set so it can still finish + fade in later; it just stops
        // blocking the queue. Released exactly once (guarded by slotAcquired).
        watchdog.current = setTimeout(() => {
          if (slotAcquired.current) {
            slotAcquired.current = false;
            videoLoadQueue.done(id);
          }
        }, SLOT_WATCHDOG_MS);
      });
    };

    // SSR / older browsers without IO: skip the gate and load immediately.
    if (typeof IntersectionObserver === 'undefined') {
      startLoading();
      return () => {
        cancelled = true;
        if (watchdog.current) clearTimeout(watchdog.current);
        if (slotAcquired.current) videoLoadQueue.done(id);
        else if (enqueued) videoLoadQueue.cancel(id);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          startLoading();
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
      if (watchdog.current) clearTimeout(watchdog.current);
      if (slotAcquired.current) videoLoadQueue.done(id);
      else if (enqueued) videoLoadQueue.cancel(id);
    };
  }, [id, src]);

  const onLoaded = () => {
    if (watchdog.current) {
      clearTimeout(watchdog.current);
      watchdog.current = undefined;
    }
    if (slotAcquired.current) {
      slotAcquired.current = false;
      videoLoadQueue.done(id);
    }
  };

  return { videoRef, ready, onLoaded };
}

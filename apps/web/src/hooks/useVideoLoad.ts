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

export function useVideoLoad(src: string | undefined) {
  const id = useId();
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const slotAcquired = useRef(false);

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
      });
    };

    // SSR / older browsers without IO: skip the gate and load immediately.
    if (typeof IntersectionObserver === 'undefined') {
      startLoading();
      return () => {
        cancelled = true;
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
      if (slotAcquired.current) videoLoadQueue.done(id);
      else if (enqueued) videoLoadQueue.cancel(id);
    };
  }, [id, src]);

  const onLoaded = () => {
    if (slotAcquired.current) {
      slotAcquired.current = false;
      videoLoadQueue.done(id);
    }
  };

  return { videoRef, ready, onLoaded };
}

/**
 * useVideoLoad — Hook that gates a video's src through the shared load queue.
 *
 * Usage:
 *   const { videoRef, ready } = useVideoLoad(videoId, videoSrc);
 *   <video ref={videoRef} src={ready ? videoSrc : undefined} ... />
 *
 * The video's src is only set once the queue grants a loading slot.
 * When the video loads (or errors), the slot is freed for the next video.
 */
import { useEffect, useRef, useState, useId } from 'react';
import { videoLoadQueue } from '@/lib/videoLoadQueue';

export function useVideoLoad(src: string | undefined) {
  const id = useId();
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const slotAcquired = useRef(false);

  useEffect(() => {
    if (!src) return;

    let cancelled = false;

    videoLoadQueue.enqueue(id).then(() => {
      if (cancelled) {
        videoLoadQueue.done(id);
        return;
      }
      slotAcquired.current = true;
      setReady(true);
    });

    return () => {
      cancelled = true;
      if (slotAcquired.current) {
        videoLoadQueue.done(id);
      } else {
        videoLoadQueue.cancel(id);
      }
    };
  }, [id, src]);

  /** Call this from the video's onLoadedData or onError to free the slot */
  const onLoaded = () => {
    if (slotAcquired.current) {
      slotAcquired.current = false;
      videoLoadQueue.done(id);
    }
  };

  return { videoRef, ready, onLoaded };
}

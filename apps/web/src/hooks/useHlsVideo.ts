import { useEffect, type RefObject } from 'react';
import Hls from 'hls.js';

/**
 * Attach an HLS manifest to a `<video>` element. For browsers that natively
 * play HLS (Safari, iOS), we just set the `src` and let the platform handle
 * adaptive switching. Everywhere else we use hls.js to fetch the manifest
 * and feed segments through MSE.
 *
 * Pass-through behavior for non-`.m3u8` sources: we do nothing — the caller's
 * `<video src=...>` continues to play progressive MP4/WebM as before.
 *
 * @returns nothing — side-effects only. Cleans up the hls.js instance on
 *          unmount or when `src` changes.
 */
export function useHlsVideo(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | null | undefined
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const isHls = /\.m3u8(\?|#|$)/i.test(src);
    if (!isHls) return; // Caller's <video src=...> handles progressive playback.

    // Safari / iOS: native HLS. Setting src directly plays adaptively without hls.js.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return;
    }

    // Other browsers: use Media Source Extensions via hls.js.
    if (!Hls.isSupported()) {
      // Last-resort: try setting the src anyway. Some browsers will refuse;
      // the <video> element's onError will surface the failure.
      video.src = src;
      return;
    }

    const hls = new Hls({
      // Conservative defaults tuned for IPFS-served playlists where segment
      // RTT can spike. Hls.js's defaults assume a CDN.
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      lowLatencyMode: false,
      backBufferLength: 30,
      // Let hls.js do its own ABR picking — start at the lowest rendition so
      // first-frame is fast, then ramp.
      startLevel: 0,
    });

    hls.loadSource(src);
    hls.attachMedia(video);

    return () => {
      try {
        hls.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [videoRef, src]);
}

/** True when a URL points at an HLS playlist. */
export function isHlsUrl(src?: string | null): boolean {
  if (!src) return false;
  return /\.m3u8(\?|#|$)/i.test(src);
}

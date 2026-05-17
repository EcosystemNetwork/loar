/**
 * useWatchSession — silent telemetry collector for episode playback.
 *
 * Lifecycle (no UI surfaces in Phase 1):
 *   1. `start` once when the user is authenticated AND a videoRef is mounted
 *      AND we have a non-empty episodeId.
 *   2. `heartbeat` every 10 s while the video is playing, sending the latest
 *      `positionSec` + accumulated `secondsWatched`.
 *   3. `end` on unmount, full-window blur (visibility hidden), or playback
 *      `ended` — with `completed: true` only on the natural `ended` event.
 *
 * Failures are swallowed silently — telemetry is best-effort. A user's
 * playback experience should never break because the collector failed to
 * write a heartbeat.
 *
 * Per-device sessions: we issue a stable random `deviceId` once and cache
 * it in localStorage so we can distinguish a user's phone from their laptop
 * later, without ever asking the server for one.
 */
import { useEffect, useRef } from 'react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';

const DEVICE_ID_KEY = 'loar.watchSessions.deviceId';
const HEARTBEAT_INTERVAL_MS = 10_000;

function getOrCreateDeviceId(): string {
  try {
    const cached = localStorage.getItem(DEVICE_ID_KEY);
    if (cached) return cached;
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    return 'unknown';
  }
}

export function useWatchSession(opts: {
  episodeId: string | null | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  sourceRoute?: string;
}) {
  const { isAuthenticated } = useWalletAuth();
  const sessionIdRef = useRef<string | null>(null);
  const secondsWatchedRef = useRef(0);
  const lastPositionRef = useRef(0);
  const endedRef = useRef(false);

  useEffect(() => {
    const video = opts.videoRef.current;
    if (!video) return;
    if (!opts.episodeId) return;
    if (!isAuthenticated) return;

    let cancelled = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const startSession = async () => {
      try {
        const res = await trpcClient.watchSessions.start.mutate({
          episodeId: opts.episodeId!,
          deviceId: getOrCreateDeviceId(),
          sourceRoute: opts.sourceRoute,
        });
        if (cancelled) return;
        sessionIdRef.current = res.sessionId;
      } catch {
        /* swallow — telemetry is best-effort */
      }
    };

    const sendHeartbeat = async (completed = false) => {
      const id = sessionIdRef.current;
      if (!id) return;
      try {
        await trpcClient.watchSessions.heartbeat.mutate({
          sessionId: id,
          positionSec: Math.floor(video.currentTime || 0),
          secondsWatched: Math.floor(secondsWatchedRef.current),
        });
        if (completed) endedRef.current = true;
      } catch {
        /* swallow */
      }
    };

    const sendEnd = async (completed: boolean) => {
      const id = sessionIdRef.current;
      if (!id || endedRef.current) return;
      endedRef.current = true;
      try {
        await trpcClient.watchSessions.end.mutate({
          sessionId: id,
          positionSec: Math.floor(video.currentTime || 0),
          secondsWatched: Math.floor(secondsWatchedRef.current),
          completed,
        });
      } catch {
        /* swallow */
      }
    };

    const onTimeUpdate = () => {
      const t = video.currentTime || 0;
      const delta = t - lastPositionRef.current;
      // Only credit forward progress; rewinds shouldn't inflate watch time
      // and rapid forward seeks shouldn't count as "watched".
      if (delta > 0 && delta < 5) {
        secondsWatchedRef.current += delta;
      }
      lastPositionRef.current = t;
    };

    const onEnded = () => {
      void sendEnd(true);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void sendHeartbeat(false);
      }
    };

    void startSession();
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    document.addEventListener('visibilitychange', onVisibility);
    heartbeatTimer = setInterval(() => void sendHeartbeat(false), HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
      document.removeEventListener('visibilitychange', onVisibility);
      // Best-effort final end ping. Fire-and-forget; React's StrictMode double
      // mount in dev will trigger an extra cycle but `endedRef` guards.
      void sendEnd(false);
    };
  }, [opts.episodeId, opts.videoRef, opts.sourceRoute, isAuthenticated]);
}

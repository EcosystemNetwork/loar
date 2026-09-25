import { useEffect, useRef } from 'react';
import { MixEngine, type BufferLookup } from '@/lib/mixEngine';
import { getAudioContext } from '@/lib/audioBuffers';
import type { AudioMix } from '@/lib/audioMix';

/** What the hook needs from an engine — lets tests substitute a fake. */
export interface MixEngineLike {
  play(mix: AudioMix, fromTime: number): void;
  stop(): void;
  dispose(): void;
  position(): number | null;
}

/** Restart the audio if it drifts this far (s) from the video clock. */
export const DRIFT_LIMIT_SEC = 0.15;
const DRIFT_CHECK_MS = 500;

interface Options {
  mix: AudioMix;
  playing: boolean;
  /** Timeline position from the video clock — read at (re)start and for drift checks. */
  playhead: number;
  getBuffer: BufferLookup;
  /** Changes whenever a buffer finishes decoding, so late arrivals join mid-playback. */
  buffersVersion?: unknown;
  createEngine?: (getBuffer: BufferLookup) => MixEngineLike;
}

const defaultEngine = (getBuffer: BufferLookup): MixEngineLike =>
  new MixEngine(getAudioContext(), getBuffer);

/**
 * Plays the audio-track mix in step with the video preview. The video element
 * is the master clock: audio starts from the playhead when playback starts,
 * restarts from the playhead when the mix (mute / solo / levels / clips) or the
 * available buffers change mid-play, and is re-synced if it drifts.
 */
export function useMixPlayback({
  mix,
  playing,
  playhead,
  getBuffer,
  buffersVersion,
  createEngine = defaultEngine,
}: Options): void {
  const engineRef = useRef<MixEngineLike | null>(null);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const mixRef = useRef(mix);
  mixRef.current = mix;
  const getBufferRef = useRef(getBuffer);
  getBufferRef.current = getBuffer;

  const engine = (): MixEngineLike | null => {
    if (!engineRef.current) {
      try {
        engineRef.current = createEngine((url) => getBufferRef.current(url));
      } catch {
        // No Web Audio (very old browser / jsdom): the preview simply stays video-only.
        return null;
      }
    }
    return engineRef.current;
  };

  // Start / stop, and restart from the playhead whenever what's audible changes.
  useEffect(() => {
    if (!playing) {
      engineRef.current?.stop();
      return;
    }
    // Browsers keep a context suspended until a gesture; play is always gesture-driven.
    void getAudioContextSafe()?.resume();
    engine()?.play(mixRef.current, playheadRef.current);
    // `mix` / `buffersVersion` are deliberate triggers: changing them mid-play re-schedules.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, mix, buffersVersion]);

  // Keep audio locked to the video.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const pos = engineRef.current?.position();
      if (pos == null) return;
      if (Math.abs(pos - playheadRef.current) > DRIFT_LIMIT_SEC) {
        engineRef.current?.play(mixRef.current, playheadRef.current);
      }
    }, DRIFT_CHECK_MS);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(
    () => () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    []
  );
}

function getAudioContextSafe(): AudioContext | null {
  try {
    return getAudioContext();
  } catch {
    return null; // no Web Audio (very old browser / test env): preview stays video-only
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/lib/audioBuffers', () => ({ getAudioContext: () => ({ resume: vi.fn() }) }));
vi.mock('@/utils/ipfs-url', () => ({ resolveIpfsUrlPreferred: (u: string) => u }));

import { DRIFT_LIMIT_SEC, useMixPlayback, type MixEngineLike } from '../useMixPlayback';
import { EMPTY_MIX, newTrack, patchTrack, type AudioMix } from '@/lib/audioMix';

function fakeEngine() {
  const e = {
    plays: [] as Array<{ mix: AudioMix; from: number }>,
    stops: 0,
    disposed: false,
    pos: null as number | null,
    play(mix: AudioMix, from: number) {
      e.plays.push({ mix, from });
    },
    stop() {
      e.stops++;
    },
    dispose() {
      e.disposed = true;
    },
    position() {
      return e.pos;
    },
  };
  return e satisfies MixEngineLike & Record<string, unknown>;
}

const opts = (over: Record<string, unknown> = {}) => ({
  mix: EMPTY_MIX,
  playing: false,
  playhead: 0,
  getBuffer: () => undefined,
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useMixPlayback', () => {
  it('does nothing until playback starts, then plays from the playhead', () => {
    const e = fakeEngine();
    const { rerender } = renderHook((p) => useMixPlayback({ ...p, createEngine: () => e }), {
      initialProps: opts({ playhead: 4 }),
    });
    expect(e.plays).toHaveLength(0);
    rerender(opts({ playing: true, playhead: 4 }));
    expect(e.plays).toEqual([{ mix: EMPTY_MIX, from: 4 }]);
  });

  it('stops when playback stops', () => {
    const e = fakeEngine();
    const { rerender } = renderHook((p) => useMixPlayback({ ...p, createEngine: () => e }), {
      initialProps: opts({ playing: true }),
    });
    rerender(opts({ playing: false }));
    expect(e.stops).toBeGreaterThan(0);
  });

  it('a mix change mid-play (mute/solo/level) restarts from the CURRENT playhead', () => {
    const e = fakeEngine();
    const base = newTrack(EMPTY_MIX);
    const { rerender } = renderHook((p) => useMixPlayback({ ...p, createEngine: () => e }), {
      initialProps: opts({ playing: true, playhead: 1, mix: base }),
    });
    rerender(
      opts({
        playing: true,
        playhead: 6.5,
        mix: patchTrack(base, base.tracks[0].id, { muted: true }),
      })
    );
    expect(e.plays).toHaveLength(2);
    expect(e.plays[1].from).toBe(6.5);
  });

  it('a playhead tick alone does NOT restart the audio', () => {
    const e = fakeEngine();
    const { rerender } = renderHook((p) => useMixPlayback({ ...p, createEngine: () => e }), {
      initialProps: opts({ playing: true, playhead: 1 }),
    });
    rerender(opts({ playing: true, playhead: 1.1 }));
    rerender(opts({ playing: true, playhead: 1.2 }));
    expect(e.plays).toHaveLength(1);
  });

  it('buffers arriving mid-play re-schedule so the late clip joins in', () => {
    const e = fakeEngine();
    const { rerender } = renderHook((p) => useMixPlayback({ ...p, createEngine: () => e }), {
      initialProps: opts({ playing: true, buffersVersion: 1 }),
    });
    rerender(opts({ playing: true, playhead: 2, buffersVersion: 2 }));
    expect(e.plays).toHaveLength(2);
  });

  it('re-syncs when the audio drifts from the video clock, and leaves an in-sync engine alone', () => {
    const e = fakeEngine();
    renderHook(() =>
      useMixPlayback({ ...opts({ playing: true, playhead: 10 }), createEngine: () => e })
    );
    e.pos = 10 + DRIFT_LIMIT_SEC / 2;
    vi.advanceTimersByTime(600);
    expect(e.plays).toHaveLength(1);
    e.pos = 10 + DRIFT_LIMIT_SEC * 3;
    vi.advanceTimersByTime(600);
    expect(e.plays).toHaveLength(2);
    expect(e.plays[1].from).toBe(10);
  });

  it('disposes the engine on unmount', () => {
    const e = fakeEngine();
    const { unmount } = renderHook(() =>
      useMixPlayback({ ...opts({ playing: true }), createEngine: () => e })
    );
    unmount();
    expect(e.disposed).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// hls.js is loaded with a dynamic import inside the hook (it is ~130KB gzip and
// only the non-Safari .m3u8 branch needs it), so these tests pin the async
// contract: it is only requested when needed, and never leaks an instance if the
// component unmounts or `src` changes before the import resolves.
const hlsInstances: { loadSource: any; attachMedia: any; destroy: any }[] = [];
let hlsSupported = true;

vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = () => hlsSupported;
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor() {
      hlsInstances.push(this);
    }
  }
  return { default: FakeHls };
});

import { useHlsVideo } from '../useHlsVideo';

function makeVideo(nativeHls: boolean) {
  const video = document.createElement('video');
  video.canPlayType = vi.fn(() => (nativeHls ? 'maybe' : '')) as any;
  return { current: video };
}

beforeEach(() => {
  hlsInstances.length = 0;
  hlsSupported = true;
});

describe('useHlsVideo', () => {
  it('does nothing for progressive (non-m3u8) sources', async () => {
    const ref = makeVideo(false);
    renderHook(() => useHlsVideo(ref, 'https://x/y.mp4'));
    await Promise.resolve();
    expect(hlsInstances).toHaveLength(0);
    expect(ref.current.src).toBe('');
  });

  it('uses native playback on Safari without touching hls.js', async () => {
    const ref = makeVideo(true);
    renderHook(() => useHlsVideo(ref, 'https://x/y.m3u8'));
    await Promise.resolve();
    expect(ref.current.src).toBe('https://x/y.m3u8');
    expect(hlsInstances).toHaveLength(0);
  });

  it('attaches hls.js elsewhere and destroys it on unmount', async () => {
    const ref = makeVideo(false);
    const { unmount } = renderHook(() => useHlsVideo(ref, 'https://x/y.m3u8'));
    await waitFor(() => expect(hlsInstances).toHaveLength(1));
    expect(hlsInstances[0].loadSource).toHaveBeenCalledWith('https://x/y.m3u8');
    expect(hlsInstances[0].attachMedia).toHaveBeenCalledWith(ref.current);
    unmount();
    expect(hlsInstances[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('never creates an instance if unmounted before the import resolves', async () => {
    const ref = makeVideo(false);
    const { unmount } = renderHook(() => useHlsVideo(ref, 'https://x/y.m3u8'));
    unmount();
    // Let the dynamic import settle; a leaked instance would show up here.
    await new Promise((r) => setTimeout(r, 20));
    expect(hlsInstances).toHaveLength(0);
  });

  it('falls back to a plain src when MSE is unsupported', async () => {
    hlsSupported = false;
    const ref = makeVideo(false);
    renderHook(() => useHlsVideo(ref, 'https://x/y.m3u8'));
    await waitFor(() => expect(ref.current.src).toBe('https://x/y.m3u8'));
    expect(hlsInstances).toHaveLength(0);
  });
});

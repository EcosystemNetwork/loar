import { describe, expect, it, vi } from 'vitest';

// audioBuffers.ts imports the ipfs resolver and trpc client for the default fetcher; the
// store class under test takes its fetcher and context as arguments.
vi.mock('@/utils/ipfs-url', () => ({ resolveIpfsUrlPreferred: (u: string) => u }));
vi.mock('@/utils/trpc', () => ({ SERVER_URL: 'http://server' }));

import { AudioBufferStore, TooLargeError } from '../audioBuffers';

const fakeBuffer = (data: number[], sampleRate = 4) =>
  ({
    sampleRate,
    numberOfChannels: 1,
    duration: data.length / sampleRate,
    getChannelData: () => Float32Array.from(data),
  }) as unknown as AudioBuffer;

function store(
  over: { fetch?: () => Promise<ArrayBuffer>; decode?: () => Promise<AudioBuffer> } = {}
) {
  const fetchBytes = vi.fn(over.fetch ?? (async () => new ArrayBuffer(8)));
  const decodeAudioData = vi.fn(over.decode ?? (async () => fakeBuffer([0.1, -0.6, 0.2, 0.3])));
  const s = new AudioBufferStore(
    () => ({ decodeAudioData }) as unknown as BaseAudioContext,
    fetchBytes
  );
  return { s, fetchBytes, decodeAudioData };
}

describe('AudioBufferStore', () => {
  it('fetches, decodes and computes peaks, then serves from cache', async () => {
    const { s, fetchBytes } = store();
    const first = await s.load('https://a/x.mp3');
    expect(first!.duration).toBe(1);
    expect(first!.peaks.length).toBeGreaterThan(0);
    expect(Math.max(...first!.peaks)).toBeCloseTo(0.6);
    expect(s.status('https://a/x.mp3')).toBe('ready');
    expect(s.get('https://a/x.mp3')).toBe(first);
    await s.load('https://a/x.mp3');
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });

  it('shares one download between simultaneous requests for the same URL', async () => {
    const { s, fetchBytes } = store();
    await Promise.all([s.load('u'), s.load('u'), s.load('u')]);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });

  it('reports loading, then notifies subscribers as state changes', async () => {
    const { s } = store();
    const seen: Array<string | undefined> = [];
    const off = s.subscribe(() => seen.push(s.status('u')));
    const v0 = s.snapshot();
    const p = s.load('u');
    expect(s.status('u')).toBe('loading');
    await p;
    expect(seen).toEqual(['loading', 'ready']);
    expect(s.snapshot()).toBeGreaterThan(v0);
    off();
    await s.load('other');
    expect(seen).toHaveLength(2); // unsubscribed
  });

  it('marks fetch and decode failures unavailable, and does not retry them', async () => {
    const failing = store({
      fetch: async () => {
        throw new Error('blocked');
      },
    });
    expect(await failing.s.load('u')).toBeNull();
    expect(failing.s.status('u')).toBe('unavailable');
    await failing.s.load('u');
    expect(failing.fetchBytes).toHaveBeenCalledTimes(1);

    const undecodable = store({
      decode: async () => {
        throw new Error('bad codec');
      },
    });
    expect(await undecodable.s.load('u')).toBeNull();
    expect(undecodable.s.status('u')).toBe('unavailable');
  });

  it('marks oversized files too-large', async () => {
    const { s } = store({
      fetch: async () => {
        throw new TooLargeError();
      },
    });
    expect(await s.load('u')).toBeNull();
    expect(s.status('u')).toBe('too-large');
  });

  it('keeps unrelated URLs independent', async () => {
    const { s } = store();
    await s.load('a');
    expect(s.status('b')).toBeUndefined();
    expect(s.get('b')).toBeUndefined();
  });
});

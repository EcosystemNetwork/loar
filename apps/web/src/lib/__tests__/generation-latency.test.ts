import { describe, it, expect } from 'vitest';
import {
  MAX_SAMPLES,
  estimateProgress,
  formatEta,
  getLatencyStats,
  latencyKey,
  loadHistory,
  recordLatency,
} from '../generation-latency';

function memoryStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set('loar:gen-latency:v1', initial);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('recordLatency', () => {
  it('stores valid samples and rejects instant/absurd/non-finite ones', () => {
    const s = memoryStorage();
    expect(recordLatency('k', 12_000, s)).toBe(true);
    expect(recordLatency('k', 100, s)).toBe(false);
    expect(recordLatency('k', 31 * 60_000, s)).toBe(false);
    expect(recordLatency('k', NaN, s)).toBe(false);
    expect(loadHistory(s).k).toEqual([12_000]);
  });

  it('keeps only the most recent MAX_SAMPLES', () => {
    const s = memoryStorage();
    for (let i = 0; i < MAX_SAMPLES + 25; i++) recordLatency('k', 1000 + i, s);
    const h = loadHistory(s).k;
    expect(h).toHaveLength(MAX_SAMPLES);
    expect(h[h.length - 1]).toBe(1000 + MAX_SAMPLES + 24);
  });

  it('survives missing or throwing storage', () => {
    expect(recordLatency('k', 5000, null)).toBe(false);
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(recordLatency('k', 5000, throwing)).toBe(false);
  });
});

describe('loadHistory', () => {
  it('returns empty for corrupt or wrongly-shaped data', () => {
    expect(loadHistory(memoryStorage('not json'))).toEqual({});
    expect(loadHistory(memoryStorage('[1,2]'))).toEqual({});
    expect(loadHistory(memoryStorage('{"k":[1,"x",null,3]}'))).toEqual({ k: [1, 3] });
  });
});

describe('getLatencyStats', () => {
  it('returns null until there are enough samples', () => {
    const s = memoryStorage();
    recordLatency('k', 10_000, s);
    recordLatency('k', 11_000, s);
    expect(getLatencyStats('k', s)).toBeNull();
    recordLatency('k', 12_000, s);
    expect(getLatencyStats('k', s)).not.toBeNull();
  });

  it('computes p50/p90 from unsorted samples', () => {
    const s = memoryStorage();
    for (const ms of [
      50_000, 10_000, 30_000, 20_000, 40_000, 60_000, 70_000, 80_000, 90_000, 100_000,
    ])
      recordLatency('k', ms, s);
    const stats = getLatencyStats('k', s)!;
    expect(stats.samples).toBe(10);
    expect(stats.p50).toBe(50_000);
    expect(stats.p90).toBe(90_000);
  });
});

describe('estimateProgress', () => {
  const stats = { p50: 20_000, p90: 40_000, samples: 10 };

  it('starts at zero and reaches 90% at p50', () => {
    expect(estimateProgress(0, stats).fraction).toBe(0);
    expect(estimateProgress(20_000, stats).fraction).toBeCloseTo(0.9);
  });

  it('is monotonic and never reaches 1', () => {
    let prev = -1;
    for (let t = 0; t <= 300_000; t += 2_500) {
      const f = estimateProgress(t, stats).fraction;
      expect(f).toBeGreaterThanOrEqual(prev);
      expect(f).toBeLessThan(1);
      prev = f;
    }
  });

  it('counts ETA down to zero and flags overdue past p90', () => {
    expect(estimateProgress(5_000, stats).etaMs).toBe(15_000);
    expect(estimateProgress(25_000, stats).etaMs).toBe(0);
    expect(estimateProgress(25_000, stats).overdue).toBe(false);
    expect(estimateProgress(40_000, stats).overdue).toBe(true);
  });

  it('tolerates p90 == p50 and negative elapsed', () => {
    const flat = { p50: 10_000, p90: 10_000, samples: 5 };
    expect(estimateProgress(15_000, flat).fraction).toBeLessThan(1);
    expect(estimateProgress(-5, flat).fraction).toBe(0);
  });
});

describe('latencyKey', () => {
  it('separates video runs by model, duration and resolution', () => {
    const base = { kind: 'video', videoModel: 'seedance' };
    expect(latencyKey({ ...base, videoDurationSec: 5, videoResolution: '720p' })).not.toBe(
      latencyKey({ ...base, videoDurationSec: 10, videoResolution: '720p' })
    );
  });
  it('falls back to defaults and non-media kinds', () => {
    expect(latencyKey({ kind: 'video' })).toBe('video:default:5s:720p');
    expect(latencyKey({ kind: 'image' })).toBe('image:auto');
    expect(latencyKey({ kind: 'audio' })).toBe('audio');
  });
});

describe('formatEta', () => {
  it('formats seconds and minutes', () => {
    expect(formatEta(4_200)).toBe('5s');
    expect(formatEta(65_000)).toBe('1m 5s');
  });
});

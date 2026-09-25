import { describe, it, expect } from 'vitest';
import { MIN_TRIM_MS, trimFromHandleDrag } from '../segmentTrim';

// A 8s clip shown in a 400px block => 20 ms per px when untrimmed.
const base = { startTrimMs: 0, endTrimMs: 8000, durationMs: 8000, blockWidthPx: 400 };

describe('trimFromHandleDrag', () => {
  it('start handle: dragging right trims the start by dx * ms-per-px', () => {
    expect(trimFromHandleDrag({ ...base, edge: 'start', dxPx: 50 })).toEqual({
      startTrimMs: 1000,
      endTrimMs: 8000,
    });
  });

  it('end handle: dragging left trims the end', () => {
    expect(trimFromHandleDrag({ ...base, edge: 'end', dxPx: -100 })).toEqual({
      startTrimMs: 0,
      endTrimMs: 6000,
    });
  });

  it('cannot extend past the original clip', () => {
    expect(trimFromHandleDrag({ ...base, edge: 'start', dxPx: -500 }).startTrimMs).toBe(0);
    expect(trimFromHandleDrag({ ...base, edge: 'end', dxPx: 500 }).endTrimMs).toBe(8000);
  });

  it('can restore previously trimmed footage by dragging back out', () => {
    const trimmed = { ...base, startTrimMs: 2000, endTrimMs: 6000, blockWidthPx: 200 }; // 20 ms/px
    expect(trimFromHandleDrag({ ...trimmed, edge: 'start', dxPx: -50 }).startTrimMs).toBe(1000);
    expect(trimFromHandleDrag({ ...trimmed, edge: 'end', dxPx: 50 }).endTrimMs).toBe(7000);
  });

  it('never trims below the minimum length, from either side', () => {
    const s = trimFromHandleDrag({ ...base, edge: 'start', dxPx: 10_000 });
    expect(s.startTrimMs).toBe(8000 - MIN_TRIM_MS);
    const e = trimFromHandleDrag({ ...base, edge: 'end', dxPx: -10_000 });
    expect(e.endTrimMs).toBe(MIN_TRIM_MS);
  });

  it('uses the CURRENT visible span for the px scale (a trimmed block is narrower per ms)', () => {
    // 2s visible in 100px => 20 ms/px again, but 4s visible in 100px => 40 ms/px.
    const twoSec = trimFromHandleDrag({
      ...base,
      startTrimMs: 0,
      endTrimMs: 2000,
      blockWidthPx: 100,
      edge: 'end',
      dxPx: -10,
    });
    expect(twoSec.endTrimMs).toBe(1800);
    const fourSec = trimFromHandleDrag({
      ...base,
      startTrimMs: 0,
      endTrimMs: 4000,
      blockWidthPx: 100,
      edge: 'end',
      dxPx: -10,
    });
    expect(fourSec.endTrimMs).toBe(3600);
  });

  it('is safe with degenerate input: zero width, NaN, out-of-range trims', () => {
    expect(trimFromHandleDrag({ ...base, edge: 'start', dxPx: 40, blockWidthPx: 0 })).toEqual({
      startTrimMs: 0,
      endTrimMs: 8000,
    });
    expect(trimFromHandleDrag({ ...base, edge: 'end', dxPx: Number.NaN })).toEqual({
      startTrimMs: 0,
      endTrimMs: 8000,
    });
    // stored trims outside the clip are normalized rather than propagated
    expect(
      trimFromHandleDrag({ ...base, startTrimMs: -50, endTrimMs: 99_999, edge: 'start', dxPx: 0 })
    ).toEqual({ startTrimMs: 0, endTrimMs: 8000 });
  });

  it('returns whole milliseconds', () => {
    const r = trimFromHandleDrag({ ...base, edge: 'start', dxPx: 33.3, blockWidthPx: 333 });
    expect(Number.isInteger(r.startTrimMs)).toBe(true);
  });
});

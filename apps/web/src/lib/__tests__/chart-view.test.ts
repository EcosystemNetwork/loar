import { describe, it, expect } from 'vitest';
import { clampWindow, panWindow, resolveWindow, zoomWindow } from '../chart-view';

describe('chart window', () => {
  it('defaults to everything and clamps bad windows', () => {
    expect(resolveWindow(100, null)).toEqual({ start: 0, end: 100 });
    expect(clampWindow(100, { start: -20, end: 30 })).toEqual({ start: 0, end: 50 });
    expect(clampWindow(100, { start: 90, end: 200 })).toEqual({ start: 0, end: 100 });
    expect(clampWindow(100, { start: 40, end: 42 })).toEqual({ start: 40, end: 50 }); // min 10 candles
    expect(clampWindow(0, { start: 0, end: 5 })).toEqual({ start: 0, end: 0 });
    expect(clampWindow(4, { start: 0, end: 2 })).toEqual({ start: 0, end: 4 }); // fewer than min → all
  });
  it('zooms in around the anchor and keeps the anchored candle in place', () => {
    const w = zoomWindow(100, { start: 0, end: 100 }, 0.5, 0.5)!;
    expect(w).toEqual({ start: 25, end: 75 });
    const right = zoomWindow(100, { start: 0, end: 100 }, 0.5, 1)!;
    expect(right.end).toBe(100);
    expect(right.end - right.start).toBe(50);
  });
  it('zooms out to the full range → null, and never below the minimum', () => {
    expect(zoomWindow(100, { start: 25, end: 75 }, 2)).toBeNull();
    const tight = zoomWindow(100, { start: 40, end: 50 }, 0.1)!;
    expect(tight.end - tight.start).toBe(10);
  });
  it('pans and stops at the edges', () => {
    expect(panWindow(100, { start: 25, end: 75 }, 10)).toEqual({ start: 35, end: 85 });
    expect(panWindow(100, { start: 25, end: 75 }, 999)).toEqual({ start: 50, end: 100 });
    expect(panWindow(100, { start: 25, end: 75 }, -999)).toEqual({ start: 0, end: 50 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  END_SLACK,
  NO_TRIM,
  isTrimmed,
  pastTrimEnd,
  resolveClipTrim,
  sceneTrimToSeconds,
  seekTarget,
  trimmedLength,
} from '../clipTrim';

describe('sceneTrimToSeconds (timeline editor, milliseconds)', () => {
  it('converts ms to seconds', () => {
    expect(sceneTrimToSeconds({ trimStart: 1500, trimEnd: 6500 })).toEqual({
      start: 1.5,
      end: 6.5,
    });
  });
  it('a missing out-point means "to the end"', () => {
    expect(sceneTrimToSeconds({ trimStart: 2000 })).toEqual({ start: 2, end: 0 });
    expect(sceneTrimToSeconds({ trimEnd: 4000 })).toEqual({ start: 0, end: 4 });
  });
  it('no scene, empty scene, junk or corrupt bounds are untrimmed', () => {
    expect(sceneTrimToSeconds(null)).toEqual(NO_TRIM);
    expect(sceneTrimToSeconds(undefined)).toEqual(NO_TRIM);
    expect(sceneTrimToSeconds({})).toEqual(NO_TRIM);
    expect(sceneTrimToSeconds({ trimStart: -5, trimEnd: 0 })).toEqual(NO_TRIM);
    expect(sceneTrimToSeconds({ trimStart: 5000, trimEnd: 3000 })).toEqual(NO_TRIM); // out before in
    expect(sceneTrimToSeconds({ trimStart: '9' as any, trimEnd: NaN })).toEqual(NO_TRIM);
  });
});

describe('resolveClipTrim', () => {
  const scene = { trimStart: 1000, trimEnd: 4000 };
  it('an untrimmed episode clip falls back to the scene trim from the editor', () => {
    expect(resolveClipTrim({ trimStart: 0, trimEnd: 0 }, scene)).toEqual({ start: 1, end: 4 });
    expect(resolveClipTrim({}, scene)).toEqual({ start: 1, end: 4 });
  });
  it("the clip's own trim (seconds) wins over the scene's", () => {
    expect(resolveClipTrim({ trimStart: 2, trimEnd: 9 }, scene)).toEqual({ start: 2, end: 9 });
    expect(resolveClipTrim({ trimStart: 0, trimEnd: 7 }, scene)).toEqual({ start: 0, end: 7 });
  });
  it('untrimmed everywhere → untrimmed', () => {
    expect(resolveClipTrim({ trimStart: 0, trimEnd: 0 }, null)).toEqual(NO_TRIM);
    expect(isTrimmed(resolveClipTrim({}, undefined))).toBe(false);
  });
});

describe('playback checks', () => {
  const trim = { start: 2, end: 6 };
  it('pastTrimEnd fires at the out-point (with slack) and never without one', () => {
    expect(pastTrimEnd(5.5, trim)).toBe(false);
    expect(pastTrimEnd(6 - END_SLACK, trim)).toBe(true);
    expect(pastTrimEnd(9, trim)).toBe(true);
    expect(pastTrimEnd(999, { start: 2, end: 0 })).toBe(false);
  });
  it('seekTarget jumps a playhead that is before the in-point, but tolerates being at it', () => {
    expect(seekTarget(0, trim)).toBe(2);
    expect(seekTarget(1.5, trim)).toBe(2);
    expect(seekTarget(1.9, trim)).toBeNull(); // within slack of the in-point
    expect(seekTarget(2, trim)).toBeNull();
    expect(seekTarget(4, trim)).toBeNull();
    expect(seekTarget(0, NO_TRIM)).toBeNull();
  });
  it('trimmedLength uses the real file length when known', () => {
    expect(trimmedLength({ start: 1, end: 6.5 }, 10)).toBe(5.5);
    expect(trimmedLength({ start: 2, end: 0 }, 10)).toBe(8);
    expect(trimmedLength({ start: 0, end: 50 }, 10)).toBe(10); // out-point past the file
    expect(trimmedLength({ start: 1, end: 6.5 }, null)).toBe(5.5);
    expect(trimmedLength({ start: 2, end: 0 }, null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { MAX_SAVED_COORDINATE, sanitizeSavedPositions } from '../savedLayout';

const ids = ['a', 'b', 'c', 'd'];

describe('sanitizeSavedPositions', () => {
  it('passes through valid positions for present nodes only', () => {
    const r = sanitizeSavedPositions({ a: { x: 1, y: 2 }, zzz: { x: 9, y: 9 } }, ids);
    expect(r.positions).toEqual({ a: { x: 1, y: 2 } });
    expect(r.rejected).toEqual([]);
    expect(r.collapsed).toBe(false);
  });

  it('returns empty for null/undefined saved', () => {
    expect(sanitizeSavedPositions(null, ids).positions).toEqual({});
    expect(sanitizeSavedPositions(undefined, ids).collapsed).toBe(false);
  });

  it.each([
    ['NaN', { x: NaN, y: 0 }],
    ['Infinity', { x: 0, y: Infinity }],
    ['null', { x: null, y: 0 }],
    ['string', { x: '12', y: 0 }],
    ['missing y', { x: 1 }],
    ['not an object', 'oops'],
    ['far off-screen', { x: MAX_SAVED_COORDINATE + 1, y: 0 }],
  ])('rejects %s', (_label, bad) => {
    const r = sanitizeSavedPositions({ a: bad, b: { x: 5, y: 5 } }, ids);
    expect(r.rejected).toEqual(['a']);
    expect(r.positions).toEqual({ b: { x: 5, y: 5 } });
  });

  it('accepts the boundary and negatives', () => {
    const r = sanitizeSavedPositions(
      { a: { x: -MAX_SAVED_COORDINATE, y: MAX_SAVED_COORDINATE } },
      ids
    );
    expect(r.positions.a).toBeDefined();
  });

  it('discards a saved layout that stacks 3+ nodes on one point', () => {
    const p = { x: 0, y: 0 };
    const r = sanitizeSavedPositions({ a: p, b: p, c: p }, ids);
    expect(r.collapsed).toBe(true);
    expect(r.positions).toEqual({});
    expect(r.rejected.sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps two nodes dragged together (not treated as a stack)', () => {
    const p = { x: 10, y: 10 };
    const r = sanitizeSavedPositions({ a: p, b: p }, ids);
    expect(r.collapsed).toBe(false);
    expect(Object.keys(r.positions)).toEqual(['a', 'b']);
  });

  it('only counts nodes actually present when detecting a stack', () => {
    const p = { x: 0, y: 0 };
    // 3 stacked in the doc, but only 2 exist on the canvas now
    const r = sanitizeSavedPositions({ a: p, b: p, gone: p }, ['a', 'b']);
    expect(r.collapsed).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  AUTO_VERSION_MIN_MS,
  decideVersion,
  stableJson,
} from '../routers/episodes/episode-versions';

describe('stableJson', () => {
  it('ignores key order at any depth', () => {
    expect(stableJson({ a: 1, b: { c: 2, d: 3 } })).toBe(stableJson({ b: { d: 3, c: 2 }, a: 1 }));
  });
  it('keeps array order (a re-ordered cut is a different cut)', () => {
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
  });
  it('treats undefined and null the same', () => {
    expect(stableJson(undefined)).toBe(stableJson(null));
  });
  it('distinguishes changed content', () => {
    expect(stableJson({ volume: 0.5 })).not.toBe(stableJson({ volume: 1 }));
  });
});

describe('decideVersion', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('records the first version of any kind', () => {
    expect(decideVersion({ hash: 'h', kind: 'auto', last: null, now })).toBe('record');
    expect(decideVersion({ hash: 'h', kind: 'manual', last: undefined, now })).toBe('record');
  });

  it('never duplicates identical content — even a manual save', () => {
    const last = { hash: 'h', createdAt: ago(60 * 60 * 1000) };
    expect(decideVersion({ hash: 'h', kind: 'manual', last, now })).toBe('skip-identical');
    expect(decideVersion({ hash: 'h', kind: 'auto', last, now })).toBe('skip-identical');
  });

  it('always records a changed manual save, however recent the last one', () => {
    const last = { hash: 'old', createdAt: ago(1000) };
    expect(decideVersion({ hash: 'new', kind: 'manual', last, now })).toBe('record');
  });

  it('throttles autosaves to one per interval', () => {
    const recent = { hash: 'old', createdAt: ago(AUTO_VERSION_MIN_MS - 1000) };
    expect(decideVersion({ hash: 'new', kind: 'auto', last: recent, now })).toBe('skip-recent');
    const stale = { hash: 'old', createdAt: ago(AUTO_VERSION_MIN_MS + 1000) };
    expect(decideVersion({ hash: 'new', kind: 'auto', last: stale, now })).toBe('record');
  });

  it('records an autosave when the last point has an unreadable timestamp', () => {
    expect(
      decideVersion({ hash: 'new', kind: 'auto', last: { hash: 'old', createdAt: 'garbage' }, now })
    ).toBe('record');
  });
});

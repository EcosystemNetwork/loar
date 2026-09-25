import { describe, it, expect } from 'vitest';
import { scopedStorageKey, isRetryableGen, isResumableGen, restoreGenerations } from '../utils';

describe('scopedStorageKey', () => {
  it('namespaces by lower-cased address', () => {
    expect(scopedStorageKey('q', '0xABC')).toBe('q:0xabc');
  });
  it('uses a shared anon bucket without an address', () => {
    expect(scopedStorageKey('q')).toBe('q:anon');
    expect(scopedStorageKey('q', null)).toBe('q:anon');
  });
  it('gives different users different keys', () => {
    expect(scopedStorageKey('q', '0xa')).not.toBe(scopedStorageKey('q', '0xb'));
  });
});

describe('isRetryableGen', () => {
  it('allows flagged image and video runs', () => {
    expect(isRetryableGen({ kind: 'image', retryable: true })).toBe(true);
    expect(isRetryableGen({ kind: 'video', retryable: true })).toBe(true);
  });
  it('rejects unflagged runs (edits, legacy persisted cards)', () => {
    expect(isRetryableGen({ kind: 'image' })).toBe(false);
    expect(isRetryableGen({ kind: 'video', retryable: false })).toBe(false);
  });
  it('rejects audio / 3D even if flagged', () => {
    expect(isRetryableGen({ kind: 'audio', retryable: true })).toBe(false);
    expect(isRetryableGen({ kind: '3d-model', retryable: true })).toBe(false);
  });
});

describe('restoreGenerations', () => {
  const g = (id: string, createdAt: number) => ({ id, createdAt });

  it('puts removed cards back newest-first', () => {
    expect(restoreGenerations([g('a', 30), g('c', 10)], [g('b', 20)]).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
  it('does not duplicate a card that is already present', () => {
    const current = [g('a', 30)];
    expect(restoreGenerations(current, [g('a', 30)])).toBe(current);
  });
  it('restores a whole cleared batch', () => {
    expect(restoreGenerations([], [g('x', 1), g('y', 2)]).map((x) => x.id)).toEqual(['y', 'x']);
  });
});

describe('isResumableGen', () => {
  it('resumes only in-flight video jobs that have a server id', () => {
    expect(isResumableGen({ kind: 'video', status: 'generating', pollGenerationId: 'g1' })).toBe(
      true
    );
  });
  it('does not resume inline runs (no server id) or finished cards', () => {
    expect(isResumableGen({ kind: 'video', status: 'generating' })).toBe(false);
    expect(isResumableGen({ kind: 'video', status: 'done', pollGenerationId: 'g1' })).toBe(false);
    expect(isResumableGen({ kind: 'video', status: 'failed', pollGenerationId: 'g1' })).toBe(false);
  });
  it('does not resume 3D jobs, which reuse pollGenerationId for a different poller', () => {
    expect(isResumableGen({ kind: '3d-model', status: 'generating', pollGenerationId: 'm1' })).toBe(
      false
    );
  });
});

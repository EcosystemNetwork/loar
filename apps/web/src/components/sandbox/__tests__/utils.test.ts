import { describe, it, expect } from 'vitest';
import { scopedStorageKey, isRetryableGen } from '../utils';

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

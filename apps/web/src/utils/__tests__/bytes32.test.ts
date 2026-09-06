/**
 * Unit tests for isBytes32Hash — the shared "is this an on-chain hash
 * placeholder, not a real URL/description" check used by the timeline editor
 * graph rebuild, the branching player, and useContractSave.
 */
import { describe, expect, it } from 'vitest';
import { isBytes32Hash } from '../bytes32';

const HEX64 = 'a'.repeat(64);

describe('isBytes32Hash', () => {
  it('accepts 0x + exactly 64 hex chars (lower, upper, mixed)', () => {
    expect(isBytes32Hash('0x' + HEX64)).toBe(true);
    expect(isBytes32Hash('0x' + 'A'.repeat(64))).toBe(true);
    expect(isBytes32Hash('0x' + '0123456789abcdefABCDEF'.padEnd(64, '0'))).toBe(true);
    expect(isBytes32Hash('0x' + '9f8e7d6c5b4a39281706'.padEnd(64, 'f'))).toBe(true);
  });

  it('rejects the wrong length (63, 65, empty body)', () => {
    expect(isBytes32Hash('0x' + 'a'.repeat(63))).toBe(false);
    expect(isBytes32Hash('0x' + 'a'.repeat(65))).toBe(false);
    expect(isBytes32Hash('0x')).toBe(false);
  });

  it('rejects a missing or malformed 0x prefix', () => {
    expect(isBytes32Hash(HEX64)).toBe(false); // no prefix
    expect(isBytes32Hash('0X' + HEX64)).toBe(false); // capital X
    expect(isBytes32Hash(' 0x' + HEX64)).toBe(false); // leading space
    expect(isBytes32Hash('0x' + HEX64 + ' ')).toBe(false); // trailing space
  });

  it('rejects non-hex characters in the body', () => {
    expect(isBytes32Hash('0x' + 'g'.repeat(64))).toBe(false);
    expect(isBytes32Hash('0x' + 'z' + 'a'.repeat(63))).toBe(false);
  });

  it('rejects real content that a length-only check would have mistaken for a hash', () => {
    // 66 chars, starts with "0x", but the body is not hex — the old
    // useContractSave check (startsWith('0x') && length === 66) dropped these.
    const decoy = '0x' + 'x'.repeat(64);
    expect(decoy.length).toBe(66);
    expect(decoy.startsWith('0x')).toBe(true);
    expect(isBytes32Hash(decoy)).toBe(false);
  });

  it('is safe on non-string input', () => {
    expect(isBytes32Hash(undefined)).toBe(false);
    expect(isBytes32Hash(null)).toBe(false);
    expect(isBytes32Hash(12345)).toBe(false);
    expect(isBytes32Hash({})).toBe(false);
    expect(isBytes32Hash(['0x' + HEX64])).toBe(false);
  });

  it('rejects a plain URL and a plain description', () => {
    expect(isBytes32Hash('https://gateway.pinata.cloud/ipfs/Qm...')).toBe(false);
    expect(isBytes32Hash('The Morning Prayer')).toBe(false);
    expect(isBytes32Hash('')).toBe(false);
  });
});

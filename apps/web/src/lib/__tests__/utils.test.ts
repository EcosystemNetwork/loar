/**
 * Unit tests for lib/utils.ts — the address-shape guards used all over the
 * app to keep Solana base58 ids out of viem/wagmi (which throw synchronously
 * on a non-hex address and blank the page).
 *
 * NOTE: `normalizeUniverseId` here is the lightweight lib/utils.ts copy
 * (EVM-lowercase only). The fuller one in lib/normalizeUniverseId.ts has its
 * own test file.
 */
import { describe, expect, it } from 'vitest';
import {
  ZERO_ADDRESS,
  asEvmAddressOrUndefined,
  cn,
  isAddressLikeUniverseId,
  isEvmAddress,
  isSolanaAddress,
  normalizeUniverseId,
  toChecksummedAddressOrUndefined,
} from '../utils';

const EVM_LOWER = '0x1234567890abcdef1234567890abcdef12345678';
const EVM_MIXED = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
const SOL_PDA = 'HqrhXafqEr9Em6RN9GQXNSF8i5ktEnBW2vXXPtHf1nBW'; // 43 base58 chars

describe('cn', () => {
  it('merges class names and resolves Tailwind conflicts (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
  it('applies clsx conditionals and drops falsy values', () => {
    expect(cn('a', false && 'b', null, undefined, ['c', { d: true, e: false }])).toBe('a c d');
  });
  it('returns "" for no meaningful input', () => {
    expect(cn()).toBe('');
    expect(cn(false, null, undefined)).toBe('');
  });
});

describe('isEvmAddress', () => {
  it('accepts 0x + exactly 40 hex chars, any case', () => {
    expect(isEvmAddress(EVM_LOWER)).toBe(true);
    expect(isEvmAddress(EVM_MIXED)).toBe(true);
    expect(isEvmAddress(ZERO_ADDRESS)).toBe(true);
  });
  it('rejects wrong length, missing prefix, and non-hex', () => {
    expect(isEvmAddress('0x' + 'a'.repeat(39))).toBe(false);
    expect(isEvmAddress('0x' + 'a'.repeat(41))).toBe(false);
    expect(isEvmAddress('a'.repeat(40))).toBe(false);
    expect(isEvmAddress('0x' + 'g'.repeat(40))).toBe(false);
  });
  it('rejects a Solana base58 address', () => {
    expect(isEvmAddress(SOL_PDA)).toBe(false);
  });
});

describe('isSolanaAddress', () => {
  it('accepts a 32-44 char base58 string', () => {
    expect(isSolanaAddress(SOL_PDA)).toBe(true);
    expect(isSolanaAddress('1'.repeat(32))).toBe(true);
    expect(isSolanaAddress('z'.repeat(44))).toBe(true);
  });
  it('rejects too short / too long / non-base58 (0, O, I, l)', () => {
    expect(isSolanaAddress('1'.repeat(31))).toBe(false);
    expect(isSolanaAddress('1'.repeat(45))).toBe(false);
    expect(isSolanaAddress('0'.repeat(40))).toBe(false); // 0 not in base58
    expect(isSolanaAddress('O'.repeat(40))).toBe(false);
    expect(isSolanaAddress('I'.repeat(40))).toBe(false);
    expect(isSolanaAddress('l'.repeat(40))).toBe(false);
  });
  it('a 40-hex EVM body without 0x happens to be base58-shaped — documents the overlap', () => {
    // this is why isAddressLikeUniverseId checks isEvmAddress (with prefix) first
    expect(isSolanaAddress('abcdefABCDEF123456789abcdefABCDEF12345678')).toBe(true);
  });
});

describe('isAddressLikeUniverseId', () => {
  it('is true for an EVM address or a Solana PDA', () => {
    expect(isAddressLikeUniverseId(EVM_LOWER)).toBe(true);
    expect(isAddressLikeUniverseId(SOL_PDA)).toBe(true);
  });
  it('is false for a human slug or a short id', () => {
    expect(isAddressLikeUniverseId('fallout-fogline')).toBe(false);
    expect(isAddressLikeUniverseId('u_123')).toBe(false);
    expect(isAddressLikeUniverseId('')).toBe(false);
  });
});

describe('normalizeUniverseId', () => {
  it('lowercases an EVM address', () => {
    expect(normalizeUniverseId(EVM_MIXED)).toBe(EVM_MIXED.toLowerCase());
  });
  it('leaves a Solana PDA case-sensitive (lowercasing it would 404)', () => {
    expect(normalizeUniverseId(SOL_PDA)).toBe(SOL_PDA);
  });
  it('passes a non-address id through untouched', () => {
    expect(normalizeUniverseId('Fallout-Fogline')).toBe('Fallout-Fogline');
  });
});

describe('asEvmAddressOrUndefined', () => {
  it('returns the value for an EVM address', () => {
    expect(asEvmAddressOrUndefined(EVM_LOWER)).toBe(EVM_LOWER);
  });
  it('returns undefined for base58, null, undefined, empty', () => {
    expect(asEvmAddressOrUndefined(SOL_PDA)).toBeUndefined();
    expect(asEvmAddressOrUndefined(null)).toBeUndefined();
    expect(asEvmAddressOrUndefined(undefined)).toBeUndefined();
    expect(asEvmAddressOrUndefined('')).toBeUndefined();
  });
  it('does NOT checksum — returns the input as given', () => {
    expect(asEvmAddressOrUndefined(EVM_MIXED)).toBe(EVM_MIXED);
  });
});

describe('toChecksummedAddressOrUndefined', () => {
  it('returns an EIP-55 checksummed address for valid hex', () => {
    const out = toChecksummedAddressOrUndefined(EVM_LOWER);
    expect(out).toBeDefined();
    expect(out!.toLowerCase()).toBe(EVM_LOWER);
    // at least one uppercase hex letter => it actually checksummed
    expect(out).toMatch(/[A-F]/);
  });
  it('returns undefined for the zero address', () => {
    expect(toChecksummedAddressOrUndefined(ZERO_ADDRESS)).toBeUndefined();
  });
  it('returns undefined for base58 / null / undefined / empty', () => {
    expect(toChecksummedAddressOrUndefined(SOL_PDA)).toBeUndefined();
    expect(toChecksummedAddressOrUndefined(null)).toBeUndefined();
    expect(toChecksummedAddressOrUndefined(undefined)).toBeUndefined();
    expect(toChecksummedAddressOrUndefined('')).toBeUndefined();
  });
  it('re-checksums a mixed-case hex address rather than rejecting it', () => {
    const out = toChecksummedAddressOrUndefined(EVM_MIXED);
    expect(out?.toLowerCase()).toBe(EVM_MIXED.toLowerCase());
  });
});

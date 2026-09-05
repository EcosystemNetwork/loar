/**
 * Unit tests for the address-classification helpers behind two chained
 * production bugs on the Solana universe editor (loar.fun/universe/$id):
 *
 * 1. "Editor not opening" — `isBlockchainUniverse` in universe/$id.tsx used
 *    to be a bare `id?.startsWith('0x')`. A Solana base58 PDA (e.g.
 *    "H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL") failed that check, so
 *    it was misclassified as "off-chain" — which skipped both the
 *    Firestore-by-address lookup and the indexer fallback for the universe
 *    doc. `universe` resolved to null and the "Universe Not Found" branch
 *    (gated on the same flag) rendered instead of the editor.
 *    `isAddressLikeUniverseId` is the fixed classifier: true for either an
 *    EVM address or a Solana PDA.
 *
 * 2. "Blank page / InvalidAddressError" (round 1) — once (1) was fixed and
 *    the page rendered further, `useUniverseAddresses`'s Firestore fallback
 *    cast whatever was in the doc's address/tokenAddress/governanceAddress
 *    fields straight to `0x${string}`. A Solana universe's doc holds base58
 *    (SPL mint / PDA) values there, not hex — that garbage value reached
 *    wagmi's `useReadContract` (TokenGateGuard, useTokenGate), and viem's
 *    address checksum threw `InvalidAddressError` synchronously during
 *    render, crashing the whole page. `asEvmAddressOrUndefined` is the
 *    guard: it only lets actual EVM addresses through.
 *
 * 3. "Blank page / InvalidAddressError" (round 2) — fixing (2) still wasn't
 *    enough: `GovernanceSidebar` read those same three Firestore fields
 *    *directly* off `finalUniverse` (bypassing useUniverseAddresses
 *    entirely) and called viem's `getAddress()` on them unconditionally —
 *    the sidebar is mounted by the parent route regardless of whether it's
 *    open, so this ran, and threw, on every page load for a Solana
 *    universe. `toChecksummedAddressOrUndefined` replaces the raw
 *    `getAddress()` call: `undefined` for anything non-EVM (or the zero
 *    address, or a hex-shaped value with a bad checksum) instead of a
 *    thrown exception.
 *
 * These are deliberately framework-free (no wagmi/react-query/DOM) per this
 * project's vitest.config.ts, which scopes unit tests to "pure logic, hooks
 * helpers" — the actual hook wiring is exercised by the e2e suite.
 */
import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  asEvmAddressOrUndefined,
  isAddressLikeUniverseId,
  isEvmAddress,
  isSolanaAddress,
  toChecksummedAddressOrUndefined,
  ZERO_ADDRESS,
} from '../utils';

// The exact id from the reported incident.
const REPORTED_SOLANA_PDA = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
const EVM_ADDRESS_LOWER = '0x89669812f850f34f907ee9e9009f501d1b008420';
const EVM_ADDRESS_MIXED_CASE = '0x89669812f850f34F907ee9e9009f501d1B008420';
// A real-looking SPL mint address (base58, 44 chars) — the shape that used
// to get cast into a `0x${string}` tokenAddress and crash TokenGateGuard.
const SOLANA_SPL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('isEvmAddress', () => {
  it('accepts a lowercase 0x + 40-hex address', () => {
    expect(isEvmAddress(EVM_ADDRESS_LOWER)).toBe(true);
  });

  it('accepts a mixed-case (unchecksummed) 0x address', () => {
    expect(isEvmAddress(EVM_ADDRESS_MIXED_CASE)).toBe(true);
  });

  it('rejects a Solana base58 PDA', () => {
    expect(isEvmAddress(REPORTED_SOLANA_PDA)).toBe(false);
  });

  it('rejects an address that is too short', () => {
    expect(isEvmAddress('0x89669812f850f34f907ee9e9009f501d1b0084')).toBe(false);
  });

  it('rejects an address that is too long', () => {
    expect(isEvmAddress(EVM_ADDRESS_LOWER + '0')).toBe(false);
  });

  it('rejects a bare slug that merely starts with 0x', () => {
    expect(isEvmAddress('0xNotAnAddress')).toBe(false);
  });
});

describe('isSolanaAddress', () => {
  it('accepts the reported 44-char base58 PDA', () => {
    expect(isSolanaAddress(REPORTED_SOLANA_PDA)).toBe(true);
  });

  it('accepts a 44-char SPL mint address', () => {
    expect(isSolanaAddress(SOLANA_SPL_MINT)).toBe(true);
  });

  it('accepts the shortest valid length (32 chars)', () => {
    expect(isSolanaAddress('1'.repeat(32))).toBe(true);
  });

  it('rejects 31 chars (one below the valid range)', () => {
    expect(isSolanaAddress('1'.repeat(31))).toBe(false);
  });

  it('rejects 45 chars (one above the valid range)', () => {
    expect(isSolanaAddress('1'.repeat(45))).toBe(false);
  });

  it('rejects base58-excluded characters (0, O, I, l)', () => {
    expect(isSolanaAddress('0'.repeat(32))).toBe(false);
    expect(isSolanaAddress('O'.repeat(32))).toBe(false);
    expect(isSolanaAddress('I'.repeat(32))).toBe(false);
    expect(isSolanaAddress('l'.repeat(32))).toBe(false);
  });

  it('rejects an EVM address', () => {
    expect(isSolanaAddress(EVM_ADDRESS_LOWER)).toBe(false);
  });
});

describe('isAddressLikeUniverseId — the universe/$id.tsx on-chain gate', () => {
  it('classifies the reported Solana PDA as address-like (the actual fix)', () => {
    // Before the fix this was `id?.startsWith('0x')`, which is false here —
    // that's precisely what made the editor render "Universe Not Found".
    expect(isAddressLikeUniverseId(REPORTED_SOLANA_PDA)).toBe(true);
  });

  it('still classifies EVM addresses as address-like', () => {
    expect(isAddressLikeUniverseId(EVM_ADDRESS_LOWER)).toBe(true);
  });

  it('does not classify a human-readable slug as address-like', () => {
    expect(isAddressLikeUniverseId('sample-universe')).toBe(false);
  });

  it('does not classify a numeric id as address-like', () => {
    expect(isAddressLikeUniverseId('12345')).toBe(false);
  });
});

describe('asEvmAddressOrUndefined — the useUniverseAddresses/useTokenGate guard', () => {
  it('passes an EVM address through unchanged (no regression for EVM universes)', () => {
    expect(asEvmAddressOrUndefined(EVM_ADDRESS_LOWER)).toBe(EVM_ADDRESS_LOWER);
  });

  it('turns a Solana SPL mint address into undefined instead of a garbage 0x value', () => {
    // This is the exact value shape that used to reach
    // `useReadContract({ address })` and throw viem's InvalidAddressError.
    expect(asEvmAddressOrUndefined(SOLANA_SPL_MINT)).toBeUndefined();
  });

  it('turns a Solana PDA into undefined', () => {
    expect(asEvmAddressOrUndefined(REPORTED_SOLANA_PDA)).toBeUndefined();
  });

  it('passes through undefined as undefined', () => {
    expect(asEvmAddressOrUndefined(undefined)).toBeUndefined();
  });

  it('turns an empty string into undefined', () => {
    expect(asEvmAddressOrUndefined('')).toBeUndefined();
  });

  it('turns null into undefined', () => {
    expect(asEvmAddressOrUndefined(null)).toBeUndefined();
  });
});

describe('toChecksummedAddressOrUndefined — the GovernanceSidebar guard', () => {
  it('checksums a valid lowercase EVM address (no regression for EVM universes)', () => {
    expect(toChecksummedAddressOrUndefined(EVM_ADDRESS_LOWER)).toBe(getAddress(EVM_ADDRESS_LOWER));
  });

  it('checksums a valid already-correct mixed-case EVM address', () => {
    expect(toChecksummedAddressOrUndefined(EVM_ADDRESS_MIXED_CASE)).toBe(
      getAddress(EVM_ADDRESS_MIXED_CASE)
    );
  });

  it('turns the reported Solana PDA into undefined instead of throwing (the actual crash)', () => {
    // Before this fix, GovernanceSidebar called `getAddress()` on this value
    // directly and it threw InvalidAddressError synchronously during render.
    expect(() => toChecksummedAddressOrUndefined(REPORTED_SOLANA_PDA)).not.toThrow();
    expect(toChecksummedAddressOrUndefined(REPORTED_SOLANA_PDA)).toBeUndefined();
  });

  it('turns a Solana SPL mint address into undefined instead of throwing', () => {
    expect(() => toChecksummedAddressOrUndefined(SOLANA_SPL_MINT)).not.toThrow();
    expect(toChecksummedAddressOrUndefined(SOLANA_SPL_MINT)).toBeUndefined();
  });

  it('treats the zero address as unset (prevents contract calls to address(0))', () => {
    expect(toChecksummedAddressOrUndefined(ZERO_ADDRESS)).toBeUndefined();
  });

  it('re-checksums a wrong-case-but-still-hex-shaped address rather than rejecting it', () => {
    // getAddress() does NOT throw for a mere EIP-55 checksum mismatch on an
    // otherwise-valid hex address — it silently re-checksums it. (Confirmed
    // against viem directly: only genuinely non-hex-shaped input throws.)
    // This just pins down that this helper doesn't fight that behavior.
    const wrongCase = '0x89669812F850f34f907ee9e9009f501d1b008420';
    expect(getAddress(wrongCase)).toBe(getAddress(EVM_ADDRESS_LOWER));
    expect(toChecksummedAddressOrUndefined(wrongCase)).toBe(getAddress(EVM_ADDRESS_LOWER));
  });

  it('never throws for arbitrary non-address strings (defense in depth)', () => {
    for (const bad of ['not-an-address', '0x123', REPORTED_SOLANA_PDA, SOLANA_SPL_MINT, '0x']) {
      expect(() => toChecksummedAddressOrUndefined(bad)).not.toThrow();
      expect(toChecksummedAddressOrUndefined(bad)).toBeUndefined();
    }
  });

  it('passes through undefined and empty string as undefined', () => {
    expect(toChecksummedAddressOrUndefined(undefined)).toBeUndefined();
    expect(toChecksummedAddressOrUndefined('')).toBeUndefined();
  });
});

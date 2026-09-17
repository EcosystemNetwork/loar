/**
 * Regression test for `isBlockchainUniverse` in types/universe.ts.
 *
 * It used to be a bare `!!u?.address?.startsWith('0x')`, which misclassified
 * every Solana universe as non-blockchain — UniverseSidebar (the only
 * consumer) uses the result to gate the explorer link, the "mint token"
 * publish flow, and the admin-panel entry point, all of which were
 * consequently hidden for Solana universe owners even when correctly
 * identified as admin. Fixed to mirror `isAddressLikeUniverseId`
 * (EVM `0x…` OR Solana base58), same as the universe/$id.tsx route's own
 * on-chain gate.
 */
import { describe, expect, it } from 'vitest';
import { isBlockchainUniverse, type UniverseData } from '../universe';

const base: UniverseData = { id: 'x', name: 'x', description: '' };

describe('isBlockchainUniverse', () => {
  it('is true for an EVM address (no regression)', () => {
    expect(
      isBlockchainUniverse({ ...base, address: '0x89669812f850f34f907ee9e9009f501d1b008420' })
    ).toBe(true);
  });

  it('is true for a Solana base58 PDA (the actual fix)', () => {
    expect(
      isBlockchainUniverse({ ...base, address: 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL' })
    ).toBe(true);
  });

  it('is false for a human-readable slug address', () => {
    expect(isBlockchainUniverse({ ...base, address: 'sample-universe' })).toBe(false);
  });

  it('is false when address is undefined', () => {
    expect(isBlockchainUniverse({ ...base, address: undefined })).toBe(false);
  });

  it('is false for null and undefined universes', () => {
    expect(isBlockchainUniverse(null)).toBe(false);
    expect(isBlockchainUniverse(undefined)).toBe(false);
  });

  it('is false for an empty-string address', () => {
    expect(isBlockchainUniverse({ ...base, address: '' })).toBe(false);
  });
});

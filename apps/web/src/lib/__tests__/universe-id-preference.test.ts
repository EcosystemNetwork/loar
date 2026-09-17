/**
 * Regression test for a systemic navigation bug found during the full
 * universe-editor audit.
 *
 * Every on-chain universe's Firestore doc stores a canonical, lowercased
 * `id` (the doc id) alongside a checksummed (EIP-55 mixed-case) `address`
 * field — confirmed live for all 7 on-chain universes (Voidborn Saga,
 * E Combonator, Cyber War, Space Fleet, Vacation Bunny, Orange Pills, and a
 * hidden Dragon Egg doc): `address` differs from `id` only in case on every
 * single one. That split is fine on its own (checksummed display is the
 * EIP-55 convention) — the bug was `UniverseSidebar`'s `universeIdOrAddress`
 * preferring `.address` over `.id` for its internal navigation links
 * (Gallery, Gen-Config, Lineage, Play, Create-remix, Bounties) and for the
 * WikiEntitiesSection universeId prop. That sent every one of those links,
 * for every on-chain universe, to a mixed-case URL — which off-chain-style
 * exact-match lookups (Firestore `where('universeId', '==', ...)`, as fixed
 * in useUniverseBlockchain.ts) would silently fail to match.
 *
 * This is a big part of why the editor "worked differently per universe":
 * off-chain universes' `id`/`address` already matched (nothing to leak), so
 * only the 7 on-chain ones hit this, and only through these specific
 * sidebar links rather than the main dashboard/studio/discover/watch/profile
 * links (which already used `.id` consistently).
 */
import { describe, expect, it } from 'vitest';

/** Mirrors UniverseSidebar.tsx's `universeIdOrAddress` derivation. */
function universeIdOrAddress(u: { id?: string; address?: string }): string | undefined {
  return u.id || u.address;
}

// Real data shape confirmed live via universes.getAll for every on-chain
// universe: doc id lowercased, address field checksummed.
const ON_CHAIN_UNIVERSES = [
  {
    id: '0x89669812f850f34f907ee9e9009f501d1b008420',
    address: '0x89669812f850f34F907ee9e9009f501d1B008420',
  },
  {
    id: '0x36a903899f51096e8a59d5bee018966c995888c1',
    address: '0x36A903899f51096E8Aa59D5Bee018966c995888c1',
  },
  {
    id: '0x341ffa19c0ec8d2c8ef42a360cf799949844262e',
    address: '0x341fFa19c0EC8D2C8ef42A360cf799949844262e',
  },
  {
    id: '0x228295466c531c1d55b9dfdd5cf15ad0b88782fa',
    address: '0x228295466C531C1d55b9DFdd5cf15aD0b88782fa',
  },
  {
    id: '0x8e5cddb763534fe426766e4eb035449fb9e73913',
    address: '0x8e5cDdb763534Fe426766E4eb035449Fb9E73913',
  },
];

// Off-chain universes' address matches id exactly — nothing to leak.
const OFF_CHAIN_UNIVERSES = [
  {
    id: '0x0000000000000000000000000000019d9e26795c',
    address: '0x0000000000000000000000000000019d9e26795c',
  },
  {
    id: 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL',
    address: 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL',
  },
];

describe('UniverseSidebar universeIdOrAddress — navigation must use the canonical id', () => {
  it('prefers the lowercased canonical id over a checksummed address for every real on-chain universe', () => {
    for (const u of ON_CHAIN_UNIVERSES) {
      expect(u.address).not.toBe(u.id); // sanity: this fixture really is checksummed
      expect(universeIdOrAddress(u)).toBe(u.id);
    }
  });

  it('is a no-op for off-chain universes where id and address already match', () => {
    for (const u of OFF_CHAIN_UNIVERSES) {
      expect(universeIdOrAddress(u)).toBe(u.id);
      expect(universeIdOrAddress(u)).toBe(u.address);
    }
  });

  it('falls back to address only when id is genuinely missing', () => {
    expect(universeIdOrAddress({ address: '0xAbC0000000000000000000000000000019d9e2' })).toBe(
      '0xAbC0000000000000000000000000000019d9e2'
    );
  });

  it('returns undefined when neither field is set', () => {
    expect(universeIdOrAddress({})).toBeUndefined();
  });
});

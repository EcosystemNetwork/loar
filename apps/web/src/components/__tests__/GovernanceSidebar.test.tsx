/**
 * Mount-level regression test for GovernanceSidebar on Solana ("fun-mode")
 * universes.
 *
 * This component is mounted unconditionally by universe/$id.tsx regardless
 * of whether the panel is open, and has already crashed the whole editor
 * twice for Solana universes (see universe-address-helpers.test.ts's
 * incidents 2 and 3) — both times because a base58 PDA/mint value reached
 * viem's `getAddress()` unguarded. Those incidents are pinned at the pure
 * `toChecksummedAddressOrUndefined` level already; this test instead mounts
 * the real component so a *new* unguarded address read in this file (or a
 * regression reintroducing a raw `getAddress()` call) fails here instead of
 * only in production.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { UniverseData } from '@/types/universe';

vi.mock('wagmi', () => ({
  useReadContract: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
  usePublicClient: () => undefined,
}));

vi.mock('@/hooks/useCircleWrite', () => ({
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
}));

vi.mock('@/hooks/useWalletAccount', () => ({
  useWalletAccount: () => ({ address: undefined }),
}));

const mockUseIsUniverseAdmin = vi.fn(() => ({
  isAdmin: false,
  isSafe: false,
  adminAddress: undefined,
  safeAddress: undefined,
  owners: [] as string[],
  threshold: 0,
  isLoading: false,
  isError: false,
}));
vi.mock('@/hooks/useIsUniverseAdmin', () => ({
  useIsUniverseAdmin: () => mockUseIsUniverseAdmin(),
}));

import { GovernanceSidebar } from '../GovernanceSidebar';

// The exact universe from the reported "nodes won't populate" incident —
// a Solana fun-mode (non-minted) universe whose address/tokenAddress/
// governanceAddress are all the same base58 PDA.
const SOLANA_UNIVERSE: UniverseData = {
  id: 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL',
  name: 'Techno Antichrist',
  description: '',
  address: 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL',
  tokenAddress: 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL',
  governanceAddress: 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL',
  universeType: 'monetized',
};

const EVM_UNIVERSE: UniverseData = {
  id: '0x89669812f850f34f907ee9e9009f501d1b008420',
  name: 'Voidborn Saga',
  description: '',
  address: '0x89669812f850f34f907ee9e9009f501d1b008420',
  tokenAddress: '0x89669812f850f34f907ee9e9009f501d1b008421',
  governanceAddress: '0x89669812f850f34f907ee9e9009f501d1b008422',
  universeType: 'monetized',
};

function renderSidebar(finalUniverse: UniverseData | null, isOpen: boolean) {
  return render(
    <GovernanceSidebar
      isOpen={isOpen}
      onClose={() => {}}
      finalUniverse={finalUniverse}
      nodes={[]}
    />
  );
}

describe('GovernanceSidebar — mounted unconditionally on universe/$id.tsx', () => {
  it('does not throw when mounted closed for a Solana universe (the actual historical crash site)', () => {
    expect(() => renderSidebar(SOLANA_UNIVERSE, false)).not.toThrow();
  });

  it('does not throw when opened for a Solana universe', () => {
    expect(() => renderSidebar(SOLANA_UNIVERSE, true)).not.toThrow();
  });

  it('does not throw when finalUniverse is null (universe doc not loaded yet)', () => {
    expect(() => renderSidebar(null, false)).not.toThrow();
  });

  it('does not throw for a well-formed EVM universe (no regression)', () => {
    expect(() => renderSidebar(EVM_UNIVERSE, true)).not.toThrow();
  });

  it('shows a "not configured" state instead of governance controls for a Solana universe', () => {
    const { getByText } = renderSidebar(SOLANA_UNIVERSE, true);
    // isGovernanceConfigured is false (all three addresses fail the EVM
    // checksum guard), so the panel must render its empty-state copy rather
    // than attempting to read/write a Governor contract with base58 values.
    expect(getByText(/not.*configured|no governance/i)).toBeTruthy();
  });
});

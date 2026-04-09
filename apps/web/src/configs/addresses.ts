/**
 * Contract Address Registry — Sepolia Only
 *
 * Multi-chain addresses (Base, Solana, SUI) preserved on feature/multi-chain branch.
 */

import type { SupportedEvmChainId } from './chains';

export interface EvmAddresses {
  universeManager: `0x${string}`;
  loarToken: `0x${string}`;
  paymentRouter: `0x${string}`;
  creditManager: `0x${string}`;
  rightsRegistry: `0x${string}`;
  revenueModuleFactory: `0x${string}`;
  canonMarketplace: `0x${string}`;
  adPlacement: `0x${string}`;
  subscriptionManager: `0x${string}`;
  licensingRegistry: `0x${string}`;
  collabManager: `0x${string}`;
  analyticsRegistry: `0x${string}`;
  loarHook: `0x${string}`;
  lpLocker: `0x${string}`;
  feeLocker: `0x${string}`;
  // Beacon addresses (for upgrades, not direct interaction)
  episodeEditionBeacon: `0x${string}`;
  characterBeacon: `0x${string}`;
  entityBeacon: `0x${string}`;
  entityEditionBeacon: `0x${string}`;
  episodeNftBeacon: `0x${string}`;
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;

export const EVM_ADDRESSES: Record<SupportedEvmChainId, EvmAddresses> = {
  11155111: {
    universeManager: '0x7af142BbD14CaEECdA68f948F467Da0257f6B114',
    loarToken: '0x0A647b3b7426Bce958e7C2FE59f0a89191952C17',
    paymentRouter: '0xD8b49c99aDb51575eea4FB795645fc9e1ce4Fa9C',
    creditManager: '0x7bB6cDdd392Bf8a6a6E58fd8600B87c8455E8240',
    rightsRegistry: '0x711eC315392f6f9FFd37e673B35acc63b9999323',
    revenueModuleFactory: '0x056dDe6c068cE3FE17C2E6eE6cfA8F76eB5A5264',
    canonMarketplace: '0x8e6c09198267B07E3FC8C66F0343759111D63016',
    adPlacement: '0xB18db49DFAB0d8B05916260D457574348893601d',
    subscriptionManager: '0x99562C96389A91b17662ce5f15143f5b07b84090',
    licensingRegistry: '0xE64563E0361f26228783e6cBAd3789563A6d5eA7',
    collabManager: '0xD98755fdEA77Aa76b19DD979f9a3134502D18294',
    analyticsRegistry: '0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8',
    loarHook: '0xa66407B5a48C5CbFF4055Ca50f6189575CC2A8cC',
    lpLocker: '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',
    feeLocker: '0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f',
    episodeEditionBeacon: '0xd70A0A63d1F80D6f28BeB3e8f3FC2a34dBEC3618',
    characterBeacon: '0xe15D941140e5504AF7C1b56AC14dA236963A99ae',
    entityBeacon: '0x152ADc8350ee69162989c0C52f5ffb2f8A09E17B',
    entityEditionBeacon: '0x7e62116B9A889150E6D07830a179f3cF803c2908',
    episodeNftBeacon: '0x89c4b520319FDB6cd23cb8DC5E6b023B110F23fC',
  },
};

export function getEvmAddresses(chainId: number): EvmAddresses | null {
  return EVM_ADDRESSES[chainId as SupportedEvmChainId] ?? null;
}

/**
 * Returns true if the address is a zero address (undeployed contract).
 * Use this to guard contract interactions that would revert.
 */
export function isZeroAddress(addr: `0x${string}` | undefined): boolean {
  return !addr || addr === ZERO_ADDR;
}

/**
 * Logs warnings for undeployed contracts at startup.
 * Call once from app init to surface configuration gaps.
 */
export function warnUndeployedContracts(chainId: number): void {
  const addrs = getEvmAddresses(chainId);
  if (!addrs) {
    console.warn(`[addresses] No contract addresses configured for chain ${chainId}`);
    return;
  }
  const critical = ['loarToken'] as const;
  for (const key of critical) {
    if (isZeroAddress(addrs[key])) {
      console.warn(
        `[addresses] ${key} is zero address on chain ${chainId} — related features disabled`
      );
    }
  }
}

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
  swapRouter: `0x${string}`;
  tokenVesting: `0x${string}`;
  // Beacon addresses (for upgrades, not direct interaction)
  episodeEditionBeacon: `0x${string}`;
  characterBeacon: `0x${string}`;
  entityBeacon: `0x${string}`;
  entityEditionBeacon: `0x${string}`;
  episodeNftBeacon: `0x${string}`;
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;

export const EVM_ADDRESSES: Partial<Record<SupportedEvmChainId, EvmAddresses>> = {
  11155111: {
    universeManager: '0x66f289658Ce5FD0Bb1022251Ea4604f6B0c4D7cE',
    loarToken: '0xAEC35cAAE68de337711E3bc06b51aaAa5551b63F',
    paymentRouter: '0x920e9A9bac991554AEE2AB7c76c521e5FB3113b6',
    creditManager: '0x5110FCCaf50316D8F874F22428dC1a832F591639',
    rightsRegistry: '0x3A14A746990498d5a4eCe867db10a197f91856Bc',
    revenueModuleFactory: '0x6D5CEf09F044224A51bd59EB841769255070e5dA',
    canonMarketplace: '0xDc5998C5e334345Ac3Aa9a9c6e141f471e929c81',
    adPlacement: '0x972bD30323B0Fb5f2466E39593cCdE1e8ae3F8C1',
    subscriptionManager: '0x53542bA1e3445804D9a225C967E2677F017D1d47',
    licensingRegistry: '0xbF0Fed6125b1e05aA3Dc52B72B5cd7703990627C',
    collabManager: '0xE981454B4149BEA3a9018fa2ab77482F388ba01f',
    analyticsRegistry: '0xB86539C4bf30036B6bd1513320cF38Bc839c7922',
    loarHook: '0x9A53B31b8B4F76Bb617D6B9aAd62731f8033A8Cc',
    lpLocker: '0xc00225D9463C15280748dC2E21D8D8625982Ad54',
    feeLocker: '0x1E10b62bd2817d0C2414909027E1E63653fcCd8e',
    swapRouter: '0xcC7fDa435ba32655Dd30868Ec8CCa5DdE992660D',
    tokenVesting: '0xDE9257B07CD06f13516e1F539f660b038603A3bB',
    episodeEditionBeacon: '0x14742D6BB8eeE513D0D70a235d8B4d801F19F9ed',
    characterBeacon: '0x0BEcc54417e9AaC9289C748eb72ECBb55292756f',
    entityBeacon: '0xF951065C7d4d28805188F60a3F8bd398B7776EC8',
    entityEditionBeacon: '0xb3D7889c393b710edF2e087Cd2b7148a2556f47b',
    episodeNftBeacon: '0x3ebb4FFd384Fc971F445AA950055203916b749a5',
  },
};

export function getEvmAddresses(chainId: number): EvmAddresses | null {
  return (EVM_ADDRESSES as Record<number, EvmAddresses | undefined>)[chainId] ?? null;
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

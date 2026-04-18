/**
 * Contract Address Registry — Sepolia + Base Sepolia
 *
 * Auto-generated from deployment manifests. To update, run:
 *   pnpm sync:addresses
 *
 * Beacon addresses are preserved from the prior file — update those manually
 * after a beacon redeploy.
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
    universeManager: '0x5441273a432821d20C949768d5940960dEaC6C35',
    loarToken: '0xAEC35cAAE68de337711E3bc06b51aaAa5551b63F',
    paymentRouter: '0x0fF81B57D5B47AC5bF2A84EeA69cCf4Aa6eb0C7C',
    creditManager: '0x42d5F92F550D42B36a119949d26a34Ca1F6b2d1E',
    rightsRegistry: '0x82b4Fe50cE07a64CbF5f97E9d70F2cEb8af63EA3',
    revenueModuleFactory: '0x6D5CEf09F044224A51bd59EB841769255070e5dA',
    canonMarketplace: '0x2Bb4750B79C48e5D39c29b5e88DE05DB94A6AB1f',
    adPlacement: '0x07c8962AB19469E48c814783664574156556B4be',
    subscriptionManager: '0xdce691E3743Ad757D079E14D9C7BDf888eBFa395',
    licensingRegistry: '0x60F419E0f37dD661AF43e5326872733e89911DA9',
    collabManager: '0x43883B2BE785FCC2C098401F07a17a3BbBDAf7d7',
    analyticsRegistry: '0x908Db578775aA2391244d57A87b156f54964aF8e',
    loarHook: '0x0000000000000000000000000000000000000000',
    lpLocker: '0x7d30fd57e44aB0ca407D312976816E7052905E0A',
    feeLocker: '0x965f5C192E38b86Fa4a79A561E695C48B1DC3582',
    swapRouter: '0x7E156f3Ddd56539aB941DeEfEd1342ae5C9C09a5',
    tokenVesting: '0x5d74D9e42a52D04DEC9F895F2c9D2e14b1DdCD64',
    episodeEditionBeacon: '0x14742D6BB8eeE513D0D70a235d8B4d801F19F9ed',
    characterBeacon: '0x0BEcc54417e9AaC9289C748eb72ECBb55292756f',
    entityBeacon: '0xF951065C7d4d28805188F60a3F8bd398B7776EC8',
    entityEditionBeacon: '0xb3D7889c393b710edF2e087Cd2b7148a2556f47b',
    episodeNftBeacon: '0x3ebb4FFd384Fc971F445AA950055203916b749a5',
  },
  84532: {
    universeManager: '0xE981454B4149BEA3a9018fa2ab77482F388ba01f',
    loarToken: '0x1Ff9e293D6D4D564B99CFe57fe61f4DCdac4b5D5',
    paymentRouter: '0x3a6C6Bc90F34839a4792c107d9597a92fBCCA984',
    creditManager: '0x6077Ce7CB99Bfe1eC3c67f8635a597a76e3FbB71',
    rightsRegistry: '0x3EF8d96cf4336E46cc7091A2325B19f53b65b109',
    revenueModuleFactory: '0xE15d941140E5504Af7C1b56Ac14da236963A99AE',
    canonMarketplace: '0x222604e2185802046692293fD31dCb4Bde249Bc3',
    adPlacement: '0x751ed220B082aE763446Fe1Fd583f3962EeBe6a3',
    subscriptionManager: '0x056dDe6c068cE3FE17C2E6eE6cfA8F76eB5A5264',
    licensingRegistry: '0x8e6c09198267B07E3FC8C66F0343759111D63016',
    collabManager: '0x7bB6cDdd392Bf8a6a6E58fd8600B87c8455E8240',
    analyticsRegistry: '0xB18db49DFAB0d8B05916260D457574348893601d',
    loarHook: '0x0000000000000000000000000000000000000000',
    lpLocker: '0xa450Bde3120a23EE3AbB87fDa4fB0E9e9F6D0307',
    feeLocker: '0x40e4e01735Be9e8cC5eF64E1f36188e1763e9740',
    swapRouter: '0x69c2aA66B3bB3e5f6658Dc2a77022558e7022398',
    tokenVesting: '0x36E25222f7E5C6f4dC8f918B68C61da83330C97F',
    episodeEditionBeacon: '0x7980622e335E72fc339b2FaA3d08DEE8CC745F4f',
    characterBeacon: '0x52b42135703A0B4180F56323e01a75B7186dB3F9',
    entityBeacon: '0x4EE8A6055270Ee5b9Cc4132c98CAd686bBb08Fc4',
    entityEditionBeacon: '0x54CA19957b1Fa6114603f2ba0422584063fD2B02',
    episodeNftBeacon: '0xEdD26a1870344789eb7b900875516AedAe04d102',
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

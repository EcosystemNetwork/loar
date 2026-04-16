/**
 * Contract Address Registry — Sepolia + Base Sepolia
 *
 * Multi-chain addresses (Base mainnet, Solana, SUI) preserved on feature/multi-chain branch.
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
    universeManager: '0xB82dE188841a799e0dBB58D885D81BEE7A735f00',
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
    loarHook: '0xF5b2676E0fbc7551ae3E38f25D87C941C5a968CC',
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
    universeManager: '0x829666ADAc47D954297a9CD1232744E1669B9e83',
    loarToken: '0x008b6266c10d124b0e8713769c310de802d76a35',
    paymentRouter: '0x99DE0BCAEFA1ce760856a13A74De631c4b6695F4',
    creditManager: '0x7E62116b9A889150e6d07830a179f3cf803C2908',
    rightsRegistry: '0x982c153e41b8B78ca48D7A13e6766Ce85F039558',
    revenueModuleFactory: '0xE15d941140E5504Af7C1b56Ac14da236963A99AE',
    canonMarketplace: '0x152AdC8350ee69162989c0C52F5FFb2f8A09E17B',
    adPlacement: '0x89c4b520319FDb6Cd23CB8DC5E6B023b110F23fc',
    subscriptionManager: '0x4C617Ca52De2D2cA8bB0414F7F1Dd0A90a915031',
    licensingRegistry: '0x4Ce3d82B3ab99ECF404f43aa5167C1E6BF52A3cF',
    collabManager: '0x5BaAd71adD73E7748F1c1C2B67a2eB4040DcEB1c',
    analyticsRegistry: '0xa6c4bd0256DA30780529bf3cF6D78BfEdACbcBB9',
    loarHook: '0xe35adBBc6da1000BE4DCbf49ccBE3B9B70c9a8cC',
    lpLocker: '0x6C67EaC980DAF0AC8aDBD6a41E61a7833E2D5FF6',
    feeLocker: '0x2faA65c60Bb463b1CEC4eC14AD04CC29C7D04981',
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

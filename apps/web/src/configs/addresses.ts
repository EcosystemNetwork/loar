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
    universeManager: '0x5441273a432821d20C949768d5940960dEaC6C35',
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
    loarToken: '0x1Ff9e293D6D4D564B99CFe57fe61f4DCdac4b5D5',
    paymentRouter: '0x5d5E30F23487D5D9AF73C3D97b054BEe7c317429',
    creditManager: '0x60d6Cd20B6aE2d8050Ec96436D3dF7A95B5a0e99',
    rightsRegistry: '0x30E7b8aC9BA8BA8bCd970714a367d380CED9FbE3',
    revenueModuleFactory: '0xeE8aC1e1Ae9Ff2e039537559e704E361B39Fb6D8',
    canonMarketplace: '0x9FC304306Af5eE0f55B92C58cddE1e8ae3F8C1',
    adPlacement: '0x0a4678b657b558F9fd0461d6B5613f29428EaF6C',
    subscriptionManager: '0x75F68A9D650B1e9a52506e424Ea2b095Cbb3A52D',
    licensingRegistry: '0xCc773ed0d6c8f05B90A7C214a7341c8A190627b9',
    collabManager: '0xFE69b81aBC8F903801AC7f91CaD052d8575AC039',
    analyticsRegistry: '0x7a580b50b8F8F83D163a03f70c808b3B90537350',
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

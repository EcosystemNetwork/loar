/**
 * Multi-Chain Contract Address Registry
 *
 * Resolves contract/program addresses by chain family and network.
 * EVM addresses are hex (0x...), Solana addresses are base58.
 */

import type { SupportedEvmChainId } from './chains';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvmAddresses {
  universeManager: `0x${string}`;
  loarToken: `0x${string}`;
  paymentRouter: `0x${string}`;
  creditManager: `0x${string}`;
  rightsRegistry: `0x${string}`;
  revenueModuleFactory: `0x${string}`;
  loarHook: `0x${string}`;
  lpLocker: `0x${string}`;
  feeLocker: `0x${string}`;
}

export interface SolanaAddresses {
  loarToken: string; // Program ID
  loarMint: string; // Token mint address
  universeManager: string;
  paymentRouter: string;
  creditManager: string;
  rightsRegistry: string;
  nftEpisodes: string;
  nftCharacters: string;
  nftEntities: string;
}

// ---------------------------------------------------------------------------
// EVM Addresses (by chain ID)
// ---------------------------------------------------------------------------

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;

export const EVM_ADDRESSES: Record<SupportedEvmChainId, EvmAddresses> = {
  // Sepolia testnet (current dev)
  11155111: {
    universeManager: '0x7af142BbD14CaEECdA68f948F467Da0257f6B114',
    loarToken: ZERO_ADDR, // TODO: deploy
    paymentRouter: ZERO_ADDR, // TODO: deploy
    creditManager: ZERO_ADDR, // TODO: deploy
    rightsRegistry: ZERO_ADDR, // TODO: deploy
    revenueModuleFactory: ZERO_ADDR, // TODO: deploy
    loarHook: '0xa66407B5a48C5CbFF4055Ca50f6189575CC2A8cC',
    lpLocker: '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',
    feeLocker: '0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f',
  },
  // Base Sepolia testnet
  84532: {
    universeManager: ZERO_ADDR,
    loarToken: ZERO_ADDR,
    paymentRouter: ZERO_ADDR,
    creditManager: ZERO_ADDR,
    rightsRegistry: ZERO_ADDR,
    revenueModuleFactory: ZERO_ADDR,
    loarHook: ZERO_ADDR,
    lpLocker: ZERO_ADDR,
    feeLocker: ZERO_ADDR,
  },
  // Base mainnet
  8453: {
    universeManager: ZERO_ADDR,
    loarToken: ZERO_ADDR,
    paymentRouter: ZERO_ADDR,
    creditManager: ZERO_ADDR,
    rightsRegistry: ZERO_ADDR,
    revenueModuleFactory: ZERO_ADDR,
    loarHook: ZERO_ADDR,
    lpLocker: ZERO_ADDR,
    feeLocker: ZERO_ADDR,
  },
};

// ---------------------------------------------------------------------------
// Solana Addresses (by cluster)
// ---------------------------------------------------------------------------

export const SOLANA_ADDRESSES: Record<string, SolanaAddresses> = {
  devnet: {
    loarToken: 'LoarTokenxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // TODO: deploy
    loarMint: '', // Set after mint creation
    universeManager: 'UniMgrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    paymentRouter: 'PayRtrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    creditManager: 'CrdMgrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    rightsRegistry: 'RghtRgxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    nftEpisodes: 'NftEpxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    nftCharacters: 'NftChxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    nftEntities: 'NftEnxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
  'mainnet-beta': {
    loarToken: '',
    loarMint: '',
    universeManager: '',
    paymentRouter: '',
    creditManager: '',
    rightsRegistry: '',
    nftEpisodes: '',
    nftCharacters: '',
    nftEntities: '',
  },
};

// ---------------------------------------------------------------------------
// SUI Addresses (by network)
// ---------------------------------------------------------------------------

export interface SuiAddresses {
  loarToken: string; // Package ID
  loarTreasuryCap: string; // Treasury cap object ID
  universeManager: string;
  paymentRouter: string;
  creditManager: string;
  rightsRegistry: string;
  nftEpisodes: string;
  nftCharacters: string;
  nftEntities: string;
}

export const SUI_ADDRESSES: Record<string, SuiAddresses> = {
  testnet: {
    loarToken: '', // TODO: deploy
    loarTreasuryCap: '',
    universeManager: '',
    paymentRouter: '',
    creditManager: '',
    rightsRegistry: '',
    nftEpisodes: '',
    nftCharacters: '',
    nftEntities: '',
  },
  mainnet: {
    loarToken: '',
    loarTreasuryCap: '',
    universeManager: '',
    paymentRouter: '',
    creditManager: '',
    rightsRegistry: '',
    nftEpisodes: '',
    nftCharacters: '',
    nftEntities: '',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get EVM contract addresses for a chain. */
export function getEvmAddresses(chainId: number): EvmAddresses | null {
  return EVM_ADDRESSES[chainId as SupportedEvmChainId] ?? null;
}

/** Get Solana program addresses for a cluster. */
export function getSolanaAddresses(cluster: string = 'devnet'): SolanaAddresses {
  return SOLANA_ADDRESSES[cluster] ?? SOLANA_ADDRESSES.devnet;
}

/** Get SUI package addresses for a network. */
export function getSuiAddresses(network: string = 'testnet'): SuiAddresses {
  return SUI_ADDRESSES[network] ?? SUI_ADDRESSES.testnet;
}

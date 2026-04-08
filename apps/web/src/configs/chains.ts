/**
 * Supported Chains Configuration
 *
 * Central place for chain-related constants used across the web app.
 * Supports both EVM (Ethereum/Base) and Solana chain families.
 */
import { sepolia, baseSepolia, base } from 'viem/chains';

// ---------------------------------------------------------------------------
// Chain Families
// ---------------------------------------------------------------------------

export type ChainFamily = 'evm' | 'solana' | 'sui';

export type SolanaCluster = 'mainnet-beta' | 'devnet' | 'testnet';

export type SuiNetwork = 'mainnet' | 'testnet' | 'devnet';

// ---------------------------------------------------------------------------
// EVM Chains
// ---------------------------------------------------------------------------

/** EVM chain IDs with deployed LOAR contracts. */
export const SUPPORTED_EVM_CHAIN_IDS = [sepolia.id, baseSepolia.id, base.id] as const;
export type SupportedEvmChainId = (typeof SUPPORTED_EVM_CHAIN_IDS)[number];

/** Check if an EVM chain ID has deployed contracts. */
export function isSupportedEvmChain(chainId: number): chainId is SupportedEvmChainId {
  return (SUPPORTED_EVM_CHAIN_IDS as readonly number[]).includes(chainId);
}

// Backwards compat
export const SUPPORTED_CHAIN_IDS = SUPPORTED_EVM_CHAIN_IDS;
export type SupportedChainId = SupportedEvmChainId;
export const isSupportedChain = isSupportedEvmChain;

// ---------------------------------------------------------------------------
// Solana Clusters
// ---------------------------------------------------------------------------

export const SUPPORTED_SOLANA_CLUSTERS: SolanaCluster[] = ['devnet', 'mainnet-beta'];

export const SOLANA_CLUSTER: SolanaCluster =
  (import.meta.env.VITE_SOLANA_CLUSTER as SolanaCluster) || 'devnet';

// ---------------------------------------------------------------------------
// SUI Networks
// ---------------------------------------------------------------------------

export const SUPPORTED_SUI_NETWORKS: SuiNetwork[] = ['testnet', 'mainnet'];

export const SUI_NETWORK: SuiNetwork =
  (import.meta.env.VITE_SUI_NETWORK as SuiNetwork) || 'testnet';

// ---------------------------------------------------------------------------
// Block Explorers
// ---------------------------------------------------------------------------

/** EVM block explorer base URLs by chain ID. */
export const BLOCK_EXPLORER_URLS: Record<SupportedEvmChainId, string> = {
  [sepolia.id]: 'https://sepolia.etherscan.io',
  [baseSepolia.id]: 'https://sepolia.basescan.org',
  [base.id]: 'https://basescan.org',
};

/** Solana explorer base URL. */
export function getSolanaExplorerUrl(cluster: SolanaCluster = SOLANA_CLUSTER): string {
  if (cluster === 'mainnet-beta') return 'https://explorer.solana.com';
  return `https://explorer.solana.com/?cluster=${cluster}`;
}

/** SUI explorer base URL (suiscan.xyz). */
export function getSuiExplorerUrl(network: SuiNetwork = SUI_NETWORK): string {
  if (network === 'mainnet') return 'https://suiscan.xyz/mainnet';
  return `https://suiscan.xyz/${network}`;
}

/** Human-readable chain names. */
export const CHAIN_NAMES: Record<SupportedEvmChainId | 'solana' | 'sui', string> = {
  [sepolia.id]: 'Sepolia',
  [baseSepolia.id]: 'Base Sepolia',
  [base.id]: 'Base',
  solana: `Solana ${SOLANA_CLUSTER === 'mainnet-beta' ? '' : `(${SOLANA_CLUSTER})`}`.trim(),
  sui: `SUI ${SUI_NETWORK === 'mainnet' ? '' : `(${SUI_NETWORK})`}`.trim(),
};

// ---------------------------------------------------------------------------
// Universal Explorer Helpers
// ---------------------------------------------------------------------------

/** Get block explorer URL for an address (EVM, Solana, or SUI). */
export function getExplorerAddressUrl(
  chainIdOrFamily: number | 'solana' | 'sui',
  address: string
): string {
  if (chainIdOrFamily === 'solana') {
    const base = getSolanaExplorerUrl();
    return `${base}/address/${address}`;
  }
  if (chainIdOrFamily === 'sui') {
    const base = getSuiExplorerUrl();
    return `${base}/account/${address}`;
  }
  const baseUrl = isSupportedEvmChain(chainIdOrFamily)
    ? BLOCK_EXPLORER_URLS[chainIdOrFamily]
    : BLOCK_EXPLORER_URLS[sepolia.id];
  return `${baseUrl}/address/${address}`;
}

/** Get block explorer URL for a transaction (EVM, Solana, or SUI). */
export function getExplorerTxUrl(
  chainIdOrFamily: number | 'solana' | 'sui',
  txHash: string
): string {
  if (chainIdOrFamily === 'solana') {
    const base = getSolanaExplorerUrl();
    return `${base}/tx/${txHash}`;
  }
  if (chainIdOrFamily === 'sui') {
    const base = getSuiExplorerUrl();
    return `${base}/tx/${txHash}`;
  }
  const baseUrl = isSupportedEvmChain(chainIdOrFamily)
    ? BLOCK_EXPLORER_URLS[chainIdOrFamily]
    : BLOCK_EXPLORER_URLS[sepolia.id];
  return `${baseUrl}/tx/${txHash}`;
}

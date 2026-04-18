/**
 * Supported Chains Configuration
 *
 * Primary: Base L2 (mainnet target).
 * Testnet: Sepolia + Base Sepolia for development.
 *
 * The active chain set is controlled by VITE_CHAIN_ENV:
 *   "mainnet" → Base only
 *   "testnet" → Sepolia + Base Sepolia (default)
 */
import { sepolia, base, baseSepolia } from 'viem/chains';

const CHAIN_ENV = (import.meta.env.VITE_CHAIN_ENV ?? 'testnet') as 'mainnet' | 'testnet';

// ---------------------------------------------------------------------------
// EVM Chains
// ---------------------------------------------------------------------------

const TESTNET_CHAIN_IDS = [sepolia.id, baseSepolia.id] as const;
const MAINNET_CHAIN_IDS = [base.id] as const;

export const SUPPORTED_EVM_CHAIN_IDS =
  CHAIN_ENV === 'mainnet' ? MAINNET_CHAIN_IDS : TESTNET_CHAIN_IDS;

export type SupportedEvmChainId = (typeof SUPPORTED_EVM_CHAIN_IDS)[number];

export function isSupportedEvmChain(chainId: number): chainId is SupportedEvmChainId {
  return (SUPPORTED_EVM_CHAIN_IDS as readonly number[]).includes(chainId);
}

// Backwards compat
export const SUPPORTED_CHAIN_IDS = SUPPORTED_EVM_CHAIN_IDS;
export type SupportedChainId = SupportedEvmChainId;
export const isSupportedChain = isSupportedEvmChain;

// ---------------------------------------------------------------------------
// Block Explorers
// ---------------------------------------------------------------------------

export const BLOCK_EXPLORER_URLS: Record<number, string> = {
  [sepolia.id]: 'https://sepolia.etherscan.io',
  [base.id]: 'https://basescan.org',
  [baseSepolia.id]: 'https://sepolia.basescan.org',
};

export const CHAIN_NAMES: Record<number, string> = {
  [sepolia.id]: 'Sepolia',
  [base.id]: 'Base',
  [baseSepolia.id]: 'Base Sepolia',
};

export const EXPLORER_NAMES: Record<number, string> = {
  [sepolia.id]: 'Etherscan',
  [base.id]: 'Basescan',
  [baseSepolia.id]: 'Basescan',
};

// ---------------------------------------------------------------------------
// Explorer Helpers
// ---------------------------------------------------------------------------

export function getExplorerName(chainId: number): string {
  return EXPLORER_NAMES[chainId] ?? EXPLORER_NAMES[SUPPORTED_EVM_CHAIN_IDS[0]] ?? 'Explorer';
}

export function getExplorerAddressUrl(chainId: number, address: string): string {
  const baseUrl = BLOCK_EXPLORER_URLS[chainId] ?? BLOCK_EXPLORER_URLS[SUPPORTED_EVM_CHAIN_IDS[0]];
  return `${baseUrl}/address/${address}`;
}

export function getExplorerTxUrl(chainId: number, txHash: string): string {
  const baseUrl = BLOCK_EXPLORER_URLS[chainId] ?? BLOCK_EXPLORER_URLS[SUPPORTED_EVM_CHAIN_IDS[0]];
  return `${baseUrl}/tx/${txHash}`;
}

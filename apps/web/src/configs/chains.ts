/**
 * Supported Chains Configuration
 *
 * Currently Sepolia-only. Multi-chain support (Base, Solana, SUI)
 * is preserved on the feature/multi-chain branch.
 */
import { sepolia } from 'viem/chains';

// ---------------------------------------------------------------------------
// EVM Chains
// ---------------------------------------------------------------------------

export const SUPPORTED_EVM_CHAIN_IDS = [sepolia.id] as const;
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

export const BLOCK_EXPLORER_URLS: Record<SupportedEvmChainId, string> = {
  [sepolia.id]: 'https://sepolia.etherscan.io',
};

export const CHAIN_NAMES: Record<SupportedEvmChainId, string> = {
  [sepolia.id]: 'Sepolia',
};

// ---------------------------------------------------------------------------
// Explorer Helpers
// ---------------------------------------------------------------------------

export function getExplorerAddressUrl(chainId: number, address: string): string {
  const baseUrl = isSupportedEvmChain(chainId)
    ? BLOCK_EXPLORER_URLS[chainId]
    : BLOCK_EXPLORER_URLS[sepolia.id];
  return `${baseUrl}/address/${address}`;
}

export function getExplorerTxUrl(chainId: number, txHash: string): string {
  const baseUrl = isSupportedEvmChain(chainId)
    ? BLOCK_EXPLORER_URLS[chainId]
    : BLOCK_EXPLORER_URLS[sepolia.id];
  return `${baseUrl}/tx/${txHash}`;
}

/**
 * Supported Chains Configuration
 *
 * Central place for chain-related constants used across the web app.
 * Both Ethereum Sepolia and Base Sepolia testnets are supported.
 */
import { sepolia, baseSepolia } from 'viem/chains';

/** Chain IDs with deployed LOAR contracts. */
export const SUPPORTED_CHAIN_IDS = [sepolia.id, baseSepolia.id] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/** Check if a chain ID has deployed contracts. */
export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

/** Block explorer base URLs by chain ID. */
export const BLOCK_EXPLORER_URLS: Record<SupportedChainId, string> = {
  [sepolia.id]: 'https://sepolia.etherscan.io',
  [baseSepolia.id]: 'https://sepolia.basescan.org',
};

/** Human-readable chain names. */
export const CHAIN_NAMES: Record<SupportedChainId, string> = {
  [sepolia.id]: 'Sepolia',
  [baseSepolia.id]: 'Base Sepolia',
};

/** Get block explorer URL for an address. */
export function getExplorerAddressUrl(chainId: number, address: string): string {
  const baseUrl = isSupportedChain(chainId)
    ? BLOCK_EXPLORER_URLS[chainId]
    : BLOCK_EXPLORER_URLS[sepolia.id];
  return `${baseUrl}/address/${address}`;
}

/** Get block explorer URL for a transaction. */
export function getExplorerTxUrl(chainId: number, txHash: string): string {
  const baseUrl = isSupportedChain(chainId)
    ? BLOCK_EXPLORER_URLS[chainId]
    : BLOCK_EXPLORER_URLS[sepolia.id];
  return `${baseUrl}/tx/${txHash}`;
}

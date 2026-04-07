/**
 * Testnet Contract Addresses
 *
 * Deployed contract addresses on Sepolia and Base Sepolia for local and staging environments.
 * Keyed by chain ID so wagmi hooks can resolve the correct address automatically.
 */
import type { SupportedChainId } from './chains';

/** Universe (timeline) contract addresses by chain ID. */
export const TIMELINE_ADDRESSES: Record<SupportedChainId, `0x${string}`> = {
  11155111: '0x20a882279ea84755cf0264e77590176247503643',
  84532: '0x0000000000000000000000000000000000000000', // TODO: deploy to Base Sepolia
};

/** UniverseGovernor contract addresses by chain ID. */
export const UNIVERSEGOVERNANCE_ADDRESSES: Record<SupportedChainId, `0x${string}`> = {
  11155111: '0xa7005d4c28328facf8a064d34d5f236a464e55c1',
  84532: '0x0000000000000000000000000000000000000000', // TODO: deploy to Base Sepolia
};

/** ERC-20 governance token contract addresses by chain ID. */
export const ERC20GOVERNANCE_ADDRESSES: Record<SupportedChainId, `0x${string}`> = {
  11155111: '0x2b84355ced33f0877a339bf0bbafac1bc4c3e8d5',
  84532: '0x0000000000000000000000000000000000000000', // TODO: deploy to Base Sepolia
};

export type { SupportedChainId };

/**
 * Testnet Contract Addresses
 *
 * Deployed contract addresses on Sepolia for local and staging environments.
 * Keyed by chain ID so wagmi hooks can resolve the correct address automatically.
 */

/** Universe (timeline) contract addresses by chain ID. */
export const TIMELINE_ADDRESSES = {
  11155111: '0x20a882279ea84755cf0264e77590176247503643',
} as const;

/** UniverseGovernor contract addresses by chain ID. */
export const UNIVERSEGOVERNANCE_ADDRESSES = {
  11155111: '0xa7005d4c28328facf8a064d34d5f236a464e55c1',
} as const;

/** ERC-20 governance token contract addresses by chain ID. */
export const ERC20GOVERNANCE_ADDRESSES = {
  11155111: '0x2b84355ced33f0877a339bf0bbafac1bc4c3e8d5',
};

/** Chain IDs that have deployed contracts. */
export type SupportedChainId = keyof typeof TIMELINE_ADDRESSES;

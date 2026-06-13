/**
 * Supported Chains Configuration
 *
 * LOAR targets Ethereum only: Sepolia (11155111, default — where the LOAR
 * contracts are deployed) and mainnet (1, for swaps / trading). Base, Base
 * Sepolia, and Solana were removed 2026-06-12. Sepolia is first so it stays
 * the default selection; mainnet has no LOAR contract deploy yet, so
 * contract-gated features no-op there until addresses.ts lists them.
 */
import { mainnet, sepolia } from 'viem/chains';

// ---------------------------------------------------------------------------
// EVM Chains
// ---------------------------------------------------------------------------

export const SUPPORTED_EVM_CHAIN_IDS = [sepolia.id, mainnet.id] as const;

export type SupportedEvmChainId = (typeof SUPPORTED_EVM_CHAIN_IDS)[number];

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

export type SolanaCluster = 'devnet' | 'mainnet-beta' | 'testnet';

// Solana is removed from the chain picker (2026-06-12). The cluster type and
// explorer helpers below are kept so dormant Solana code paths still compile;
// the empty set just means no Solana options surface in the UI.
export const SUPPORTED_SOLANA_CLUSTERS: readonly SolanaCluster[] = [];

export function isSupportedSolanaCluster(cluster: string): cluster is SolanaCluster {
  return (SUPPORTED_SOLANA_CLUSTERS as readonly string[]).includes(cluster);
}

// ---------------------------------------------------------------------------
// Block Explorers / Names
// (Declared before SUPPORTED_CHAINS because evmOption() reads CHAIN_NAMES at
// module init time — see https://github.com/EcosystemNetwork/loar — moving
// these below would TDZ in production minified bundles.)
// ---------------------------------------------------------------------------

export const BLOCK_EXPLORER_URLS: Record<number, string> = {
  [sepolia.id]: 'https://sepolia.etherscan.io',
  [mainnet.id]: 'https://etherscan.io',
};

export const CHAIN_NAMES: Record<number, string> = {
  [sepolia.id]: 'Sepolia',
  [mainnet.id]: 'Ethereum',
};

export const EXPLORER_NAMES: Record<number, string> = {
  [sepolia.id]: 'Etherscan',
  [mainnet.id]: 'Etherscan',
};

// ---------------------------------------------------------------------------
// Unified chain selector model
// ---------------------------------------------------------------------------

export type ChainSelection =
  | { kind: 'evm'; chainId: SupportedEvmChainId }
  | { kind: 'solana'; cluster: SolanaCluster };

export interface ChainOption {
  /** Stable string id for <Select> values: "eip155:11155111" or "solana:devnet". */
  id: string;
  selection: ChainSelection;
  label: string;
}

function evmOption(chainId: SupportedEvmChainId): ChainOption {
  return {
    id: `eip155:${chainId}`,
    selection: { kind: 'evm', chainId },
    label: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
  };
}

function solanaOption(cluster: SolanaCluster): ChainOption {
  return {
    id: `solana:${cluster}`,
    selection: { kind: 'solana', cluster },
    label: cluster === 'mainnet-beta' ? 'Solana' : `Solana ${cluster}`,
  };
}

/** Single source of truth for the chain picker UI (universe create + sandbox). */
export const SUPPORTED_CHAINS: ChainOption[] = [
  ...SUPPORTED_EVM_CHAIN_IDS.map(evmOption),
  ...SUPPORTED_SOLANA_CLUSTERS.map(solanaOption),
];

export function chainOptionById(id: string): ChainOption | undefined {
  return SUPPORTED_CHAINS.find((c) => c.id === id);
}

/** EVM chainId → CAIP-2 selector id ("eip155:84532"). */
export function evmChainIdToSelectionId(chainId: number): string {
  return `eip155:${chainId}`;
}

/** Default selection when nothing is stored — EVM first chain (preserves prior behavior). */
export const DEFAULT_CHAIN_SELECTION: ChainSelection = {
  kind: 'evm',
  chainId: SUPPORTED_EVM_CHAIN_IDS[0],
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

/** Solana explorer (cluster-aware). Devnet/testnet need a `?cluster=` query param. */
export function getSolanaExplorerAddressUrl(cluster: SolanaCluster, address: string): string {
  const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}

export function getSolanaExplorerTxUrl(cluster: SolanaCluster, signature: string): string {
  const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

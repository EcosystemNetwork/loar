/**
 * Supported Chains Configuration
 *
 * LOAR is an EVM-canonical + Solana-distribution hybrid. Both EVM (Base / Sepolia)
 * and Solana (devnet / mainnet-beta) are first-class targets when creating
 * universes and stamping sandbox drafts.
 *
 * The active set is controlled by VITE_CHAIN_ENV:
 *   "mainnet" → Base + Solana mainnet-beta
 *   "testnet" → Sepolia + Base Sepolia + Solana devnet (default)
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
// Solana Clusters
// ---------------------------------------------------------------------------

export type SolanaCluster = 'devnet' | 'mainnet-beta' | 'testnet';

const TESTNET_SOLANA_CLUSTERS = ['devnet'] as const satisfies readonly SolanaCluster[];
const MAINNET_SOLANA_CLUSTERS = ['mainnet-beta'] as const satisfies readonly SolanaCluster[];

export const SUPPORTED_SOLANA_CLUSTERS: readonly SolanaCluster[] =
  CHAIN_ENV === 'mainnet' ? MAINNET_SOLANA_CLUSTERS : TESTNET_SOLANA_CLUSTERS;

export function isSupportedSolanaCluster(cluster: string): cluster is SolanaCluster {
  return (SUPPORTED_SOLANA_CLUSTERS as readonly string[]).includes(cluster);
}

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

/** Solana explorer (cluster-aware). Devnet/testnet need a `?cluster=` query param. */
export function getSolanaExplorerAddressUrl(cluster: SolanaCluster, address: string): string {
  const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}

export function getSolanaExplorerTxUrl(cluster: SolanaCluster, signature: string): string {
  const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

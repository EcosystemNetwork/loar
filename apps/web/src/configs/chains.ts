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
import { UniverseManager } from '@loar/abis/addresses';

// ---------------------------------------------------------------------------
// EVM Chains
// ---------------------------------------------------------------------------

export const SUPPORTED_EVM_CHAIN_IDS = [sepolia.id, mainnet.id] as const;

export type SupportedEvmChainId = (typeof SUPPORTED_EVM_CHAIN_IDS)[number];

function isSupportedEvmChain(chainId: number): chainId is SupportedEvmChainId {
  return (SUPPORTED_EVM_CHAIN_IDS as readonly number[]).includes(chainId);
}

// Backwards compat
export const SUPPORTED_CHAIN_IDS = SUPPORTED_EVM_CHAIN_IDS;
export type SupportedChainId = SupportedEvmChainId;
export const isSupportedChain = isSupportedEvmChain;

// ---------------------------------------------------------------------------
// Deployable chains — supported chains where the LOAR contracts (gated by the
// UniverseManager launchpad) actually have an on-chain address. A chain can be
// "supported" (wallet/swaps) without being "deployable" (e.g. mainnet, which is
// wired for trading but has no LOAR contract deploy yet). Contract-gated flows
// like universe creation must gate on this, NOT on isSupportedChain — otherwise
// the form silently dead-ends (mintFee read returns undefined forever).
// ---------------------------------------------------------------------------

const DEPLOYABLE_CHAIN_IDS = SUPPORTED_EVM_CHAIN_IDS.filter(
  (id) => UniverseManager[String(id) as keyof typeof UniverseManager] !== undefined
) as SupportedEvmChainId[];

export function isDeployableChain(chainId: number): boolean {
  return DEPLOYABLE_CHAIN_IDS.includes(chainId as SupportedEvmChainId);
}

/** First chain with LOAR contracts deployed — the auto-switch / fallback target. */
export const DEFAULT_DEPLOYABLE_CHAIN_ID: SupportedEvmChainId =
  DEPLOYABLE_CHAIN_IDS[0] ?? SUPPORTED_EVM_CHAIN_IDS[0];

// ---------------------------------------------------------------------------
// Block Explorers / Names
// (Declared before SUPPORTED_CHAINS because evmOption() reads CHAIN_NAMES at
// module init time — see https://github.com/EcosystemNetwork/loar — moving
// these below would TDZ in production minified bundles.)
// ---------------------------------------------------------------------------

const BLOCK_EXPLORER_URLS: Record<number, string> = {
  [sepolia.id]: 'https://sepolia.etherscan.io',
  [mainnet.id]: 'https://etherscan.io',
};

export const CHAIN_NAMES: Record<number, string> = {
  [sepolia.id]: 'Sepolia',
  [mainnet.id]: 'Ethereum',
};

const EXPLORER_NAMES: Record<number, string> = {
  [sepolia.id]: 'Etherscan',
  [mainnet.id]: 'Etherscan',
};

// ---------------------------------------------------------------------------
// Unified chain selector model
// ---------------------------------------------------------------------------

// Solana clusters — CAIP-2 `solana:<genesisHashPrefix>`. Kept as the short
// cluster name here for the picker; `@loar/abis/chain` owns the genesis map.
export type SolanaCluster = 'devnet' | 'mainnet-beta' | 'testnet';

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

const SOLANA_CLUSTER_LABELS: Record<SolanaCluster, string> = {
  'mainnet-beta': 'Solana',
  devnet: 'Solana Devnet',
  testnet: 'Solana Testnet',
};

function solanaOption(cluster: SolanaCluster): ChainOption {
  return {
    id: `solana:${cluster}`,
    selection: { kind: 'solana', cluster },
    label: SOLANA_CLUSTER_LABELS[cluster],
  };
}

/**
 * The active Solana cluster, or null when Solana isn't configured for this
 * build. Gated on `VITE_SOLANA_CLUSTER` so the picker only shows Solana once
 * the server + programs are wired (parity restoration Phase 7).
 */
export const ACTIVE_SOLANA_CLUSTER: SolanaCluster | null = ((): SolanaCluster | null => {
  const v = import.meta.env.VITE_SOLANA_CLUSTER as string | undefined;
  return v === 'devnet' || v === 'mainnet-beta' || v === 'testnet' ? v : null;
})();

export const SOLANA_ENABLED = ACTIVE_SOLANA_CLUSTER !== null;

/** Single source of truth for the chain picker UI (universe create + sandbox). */
export const SUPPORTED_CHAINS: ChainOption[] = [
  ...SUPPORTED_EVM_CHAIN_IDS.map(evmOption),
  ...(ACTIVE_SOLANA_CLUSTER ? [solanaOption(ACTIVE_SOLANA_CLUSTER)] : []),
];

export function chainOptionById(id: string): ChainOption | undefined {
  return SUPPORTED_CHAINS.find((c) => c.id === id);
}

/** EVM chainId → CAIP-2 selector id ("eip155:11155111"). */
export function evmChainIdToSelectionId(chainId: number): string {
  return `eip155:${chainId}`;
}

/** CAIP-2-ish selector id → ChainSelection. Returns null on unknown/disabled. */
export function selectionIdToSelection(id: string): ChainSelection | null {
  return chainOptionById(id)?.selection ?? null;
}

/** Narrowing helpers so consumers don't re-derive the discriminant. */
export function isEvmSelection(s: ChainSelection): s is Extract<ChainSelection, { kind: 'evm' }> {
  return s.kind === 'evm';
}
export function isSolanaSelection(
  s: ChainSelection
): s is Extract<ChainSelection, { kind: 'solana' }> {
  return s.kind === 'solana';
}

/** CAIP-2 namespace for a selection ('evm' kind maps to the CAIP-2 'eip155'). */
export function selectionNamespace(s: ChainSelection): 'eip155' | 'solana' {
  return s.kind === 'evm' ? 'eip155' : 'solana';
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

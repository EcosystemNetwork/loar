/**
 * useChain — shared, persisted chain selection for the multi-chain UI.
 *
 * A tiny external store (no context provider) so any component can read/set the
 * active chain and stay in sync. Persists to localStorage under `loar:chain`.
 * The selection model + option list live in `@/configs/chains`.
 *
 * EVM is always available. Solana appears only when the build is wired for it
 * (`VITE_SOLANA_CLUSTER` set) — see `SOLANA_ENABLED` / `ACTIVE_SOLANA_CLUSTER`.
 *
 * This does NOT replace the wallet's own chainId (wagmi `useChainId`); it's the
 * user's *intent* for which chain a universe/action targets. Data hooks branch
 * on `namespace` at the fetch layer (per docs/prd-solana-parity.md W6), not by
 * forking routes.
 */
import { useSyncExternalStore, useCallback } from 'react';
import {
  type ChainSelection,
  DEFAULT_CHAIN_SELECTION,
  SUPPORTED_CHAINS,
  chainOptionById,
  selectionNamespace,
} from '@/configs/chains';

const STORAGE_KEY = 'loar:chain';

function read(): ChainSelection {
  if (typeof window === 'undefined') return DEFAULT_CHAIN_SELECTION;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHAIN_SELECTION;
    const parsed = JSON.parse(raw) as ChainSelection;
    // Re-validate against the current option list — a stored Solana selection
    // becomes invalid if the build later drops `VITE_SOLANA_CLUSTER`.
    if (parsed?.kind === 'evm' && chainOptionById(`eip155:${parsed.chainId}`)) return parsed;
    if (parsed?.kind === 'solana' && chainOptionById(`solana:${parsed.cluster}`)) return parsed;
    return DEFAULT_CHAIN_SELECTION;
  } catch {
    return DEFAULT_CHAIN_SELECTION;
  }
}

let current: ChainSelection = read();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Cross-tab sync.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      current = read();
      emit();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): ChainSelection {
  return current;
}

function getServerSnapshot(): ChainSelection {
  return DEFAULT_CHAIN_SELECTION;
}

/** Imperative setter — usable outside React (e.g. in event handlers / stores). */
export function setChainSelection(next: ChainSelection): void {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — in-memory only */
  }
  emit();
}

export interface UseChainResult {
  chain: ChainSelection;
  /** 'eip155' | 'solana' — branch data fetches on this, not on route. */
  namespace: 'eip155' | 'solana';
  isEvm: boolean;
  isSolana: boolean;
  /** EVM chainId when `isEvm`, else undefined. */
  evmChainId: number | undefined;
  /** Solana cluster when `isSolana`, else undefined. */
  solanaCluster: 'devnet' | 'mainnet-beta' | 'testnet' | undefined;
  setChain: (next: ChainSelection) => void;
  /** Set by the picker's string id ("eip155:11155111" / "solana:devnet"). */
  setChainById: (id: string) => void;
  options: typeof SUPPORTED_CHAINS;
}

export function useChain(): UseChainResult {
  const chain = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setChainById = useCallback((id: string) => {
    const opt = chainOptionById(id);
    if (opt) setChainSelection(opt.selection);
  }, []);

  return {
    chain,
    namespace: selectionNamespace(chain),
    isEvm: chain.kind === 'evm',
    isSolana: chain.kind === 'solana',
    evmChainId: chain.kind === 'evm' ? chain.chainId : undefined,
    solanaCluster: chain.kind === 'solana' ? chain.cluster : undefined,
    setChain: setChainSelection,
    setChainById,
    options: SUPPORTED_CHAINS,
  };
}

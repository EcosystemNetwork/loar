/**
 * Chain namespace discriminator — shared between EVM and Solana flows.
 *
 * Uses CAIP-2 conventions:
 *   eip155:<chainId>            — EVM chains (1, 8453, 84532, 11155111)
 *   solana:<genesisHashPrefix>  — Solana clusters (mainnet-beta, devnet, testnet)
 *
 * The rest of the codebase (auth, Circle DCW, indexer, frontend wallet UX)
 * branches on `namespace` to pick the right adapter.
 */

export type ChainNamespace = 'eip155' | 'solana';

export type SolanaCluster = 'devnet' | 'mainnet-beta' | 'testnet';

export type EvmChainRef = {
  namespace: 'eip155';
  chainId: number;
};

export type SolanaChainRef = {
  namespace: 'solana';
  cluster: SolanaCluster;
};

export type ChainRef = EvmChainRef | SolanaChainRef;

/** CAIP-2 genesis-hash prefix per Solana cluster (first 32 chars of base58 genesis). */
export const SOLANA_GENESIS_HASH = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc7UMKUbpZF',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
} as const satisfies Record<SolanaCluster, string>;

export function isEvmChain(ref: ChainRef): ref is EvmChainRef {
  return ref.namespace === 'eip155';
}

export function isSolanaChain(ref: ChainRef): ref is SolanaChainRef {
  return ref.namespace === 'solana';
}

/** Canonical CAIP-2 string ("eip155:84532" or "solana:5eykt4..."). */
export function formatChainRef(ref: ChainRef): string {
  return isEvmChain(ref)
    ? `eip155:${ref.chainId}`
    : `solana:${SOLANA_GENESIS_HASH[ref.cluster].slice(0, 32)}`;
}

/** Parse a CAIP-2 string back to a typed ChainRef. Returns null on invalid input. */
export function parseChainRef(caip: string): ChainRef | null {
  const [ns, rest] = caip.split(':');
  if (!ns || !rest) return null;
  if (ns === 'eip155') {
    const id = Number(rest);
    return Number.isFinite(id) && id > 0 ? { namespace: 'eip155', chainId: id } : null;
  }
  if (ns === 'solana') {
    for (const cluster of ['mainnet-beta', 'devnet', 'testnet'] as const) {
      if (SOLANA_GENESIS_HASH[cluster].startsWith(rest)) {
        return { namespace: 'solana', cluster };
      }
    }
    return null;
  }
  return null;
}

/**
 * Detect an address's namespace by shape alone.
 *   eip155: 0x + 40 hex chars
 *   solana: base58, 32–44 chars (Solana addresses encode 32-byte pubkeys
 *           — base58 length varies because leading zero bytes compact)
 */
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function detectAddressNamespace(address: string): ChainNamespace | null {
  if (EVM_ADDR_RE.test(address)) return 'eip155';
  if (SOLANA_ADDR_RE.test(address)) return 'solana';
  return null;
}

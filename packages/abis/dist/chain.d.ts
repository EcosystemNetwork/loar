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
export declare const SOLANA_GENESIS_HASH: {
    readonly 'mainnet-beta': "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc7UMKUbpZF";
    readonly devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    readonly testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
};
export declare function isEvmChain(ref: ChainRef): ref is EvmChainRef;
export declare function isSolanaChain(ref: ChainRef): ref is SolanaChainRef;
/** Canonical CAIP-2 string ("eip155:84532" or "solana:5eykt4..."). */
export declare function formatChainRef(ref: ChainRef): string;
/** Parse a CAIP-2 string back to a typed ChainRef. Returns null on invalid input. */
export declare function parseChainRef(caip: string): ChainRef | null;
export declare function detectAddressNamespace(address: string): ChainNamespace | null;
//# sourceMappingURL=chain.d.ts.map
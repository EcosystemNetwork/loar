/**
 * Chain namespace discriminator for EVM flows.
 *
 * Uses CAIP-2 conventions:
 *   eip155:<chainId>            — EVM chains (1, 11155111)
 *
 * The rest of the codebase (auth, Circle DCW, indexer, frontend wallet UX)
 * branches on `namespace` to pick the right adapter.
 */
export type ChainNamespace = 'eip155';
export type EvmChainRef = {
    namespace: 'eip155';
    chainId: number;
};
export type ChainRef = EvmChainRef;
export declare function isEvmChain(ref: ChainRef): ref is EvmChainRef;
/** Canonical CAIP-2 string ("eip155:11155111"). */
export declare function formatChainRef(ref: ChainRef): string;
/** Parse a CAIP-2 string back to a typed ChainRef. Returns null on invalid input. */
export declare function parseChainRef(caip: string): ChainRef | null;
export declare function detectAddressNamespace(address: string): ChainNamespace | null;
//# sourceMappingURL=chain.d.ts.map
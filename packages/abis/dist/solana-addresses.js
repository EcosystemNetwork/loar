/**
 * Solana program IDs, SPL mints, and Bubblegum merkle trees per cluster.
 *
 * Populated after `anchor deploy` for programs, after the SPL mint and
 * Bubblegum tree creation scripts for the others. Keep keys aligned with
 * `SolanaCluster` from ./chain.ts.
 *
 * Unlike EVM (where the deployer chooses CREATE2 salts and addresses match
 * across chains), Solana program IDs are independent per cluster.
 */
/** Universe — canonical IP container, Solana sister to Universe.sol. */
export const UniverseProgram = {
    devnet: '6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD',
    'mainnet-beta': '',
};
/** Episode — cNFT mints via Bubblegum + Core promotion path for canon promotion. */
export const EpisodeProgram = {
    devnet: 'voLiAXoYbq8go1CUS9UshQRZnNu9Y44qNBZ6czgn8Bs',
    'mainnet-beta': '',
};
/** Payment — Solana Pay receiver with on-chain receipts → cNFT attribution. */
export const PaymentProgram = {
    devnet: '',
    'mainnet-beta': '',
};
/** $LOAR SPL mint per cluster. Bridge to canonical EVM $LOAR via Wormhole NTT (v2). */
export const LoarMint = {
    devnet: '',
    'mainnet-beta': '',
};
/** Bubblegum cNFT merkle tree per cluster. One tree, ~1M slots at depth=14/buffer=64. */
export const BubblegumTree = {
    devnet: '',
    'mainnet-beta': '',
};
/**
 * Read an address for the active cluster.
 * Throws if the address hasn't been populated yet for the given cluster.
 */
export function getSolanaAddress(map, cluster, label) {
    const value = map[cluster];
    if (!value) {
        throw new Error(`[solana-addresses] ${label} is not configured for cluster "${cluster}". ` +
            `Run the appropriate deploy script and update packages/abis/src/solana-addresses.ts.`);
    }
    return value;
}

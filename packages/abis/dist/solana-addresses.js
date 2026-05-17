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
/** Payment — Solana sister to PaymentRouter.sol. Routes SOL + $LOAR with
 *  pull-style accumulators per creator, owner-gated treasury, two-step
 *  ownership transfer, pause, one-way LOAR-mint lock. */
export const PaymentProgram = {
    devnet: '9xWo4djcHmGFkJnLQF9phdpsUhj6BQFW6yR8sHUsKVbj',
    'mainnet-beta': '',
};
/** $LOAR SPL mint per cluster. Token-2022 with Pausable + Metadata extensions
 *  (9 decimals, 1B supply). Bridge to canonical EVM $LOAR via Wormhole NTT (v2). */
export const LoarMint = {
    devnet: '482ScJ9EffmyWRWhVsysrPBw3LPDdUXuRL1rXoAx1tez',
    'mainnet-beta': '',
};
/** Bubblegum cNFT merkle tree per cluster. Devnet uses depth=14/buffer=64/canopy=10
 *  (16k cNFTs). Mainnet uses depth=20/buffer=64/canopy=14 (~1M cNFTs). */
export const BubblegumTree = {
    devnet: 'Dmn6X8ToDwG6VcawQ6prpm6rV3KYBdoV31RQQFrx1Tu2',
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

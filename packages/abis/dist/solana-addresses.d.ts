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
import type { SolanaCluster } from './chain';
type ClusterMap = Partial<Record<SolanaCluster, string>>;
/** Universe — canonical IP container, Solana sister to Universe.sol. */
export declare const UniverseProgram: ClusterMap;
/** Episode — cNFT mints via Bubblegum + Core promotion path for canon promotion. */
export declare const EpisodeProgram: ClusterMap;
/** Payment — Solana sister to PaymentRouter.sol. Routes SOL + $LOAR with
 *  pull-style accumulators per creator, owner-gated treasury, two-step
 *  ownership transfer, pause, one-way LOAR-mint lock. */
export declare const PaymentProgram: ClusterMap;
/** $LOAR SPL mint per cluster. Token-2022 with Pausable + Metadata extensions
 *  (9 decimals, 1B supply). Bridge to canonical EVM $LOAR via Wormhole NTT (v2). */
export declare const LoarMint: ClusterMap;
/** Bubblegum cNFT merkle tree per cluster. Devnet uses depth=14/buffer=64/canopy=10
 *  (16k cNFTs). Mainnet uses depth=20/buffer=64/canopy=14 (~1M cNFTs). */
export declare const BubblegumTree: ClusterMap;
/**
 * Read an address for the active cluster.
 * Throws if the address hasn't been populated yet for the given cluster.
 */
export declare function getSolanaAddress(map: ClusterMap, cluster: SolanaCluster, label: string): string;
export {};
//# sourceMappingURL=solana-addresses.d.ts.map
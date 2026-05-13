/**
 * Solana Universe program client (web).
 *
 * Talks to apps/programs/programs/universe (Anchor 0.31). We hand-roll the
 * `initialize_universe` instruction so the web bundle doesn't pull in the full
 * @coral-xyz/anchor runtime — the instruction is trivial: 8-byte Anchor
 * discriminator + 32 (content_hash) + 32 (plot_hash) + 1 (visibility enum).
 *
 * Program ID (devnet, from apps/programs/Anchor.toml):
 *   6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { Cluster } from '@solana/web3.js';
import { clusterApiUrl } from '@solana/web3.js';

export type UniverseProgramCluster = 'devnet' | 'mainnet-beta' | 'testnet';

/** Devnet/mainnet program ID. Update when the program is deployed to mainnet. */
export const UNIVERSE_PROGRAM_ID = new PublicKey('6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD');

// sha256("global:initialize_universe").slice(0, 8) — Anchor instruction discriminator
const INITIALIZE_UNIVERSE_DISCRIMINATOR = Uint8Array.from([122, 246, 79, 134, 70, 174, 143, 171]);

export type Visibility = 'private' | 'public';

function visibilityByte(v: Visibility): number {
  // Matches the Rust enum order in apps/programs/programs/universe/src/lib.rs.
  return v === 'private' ? 0 : 1;
}

/**
 * Compute the Universe PDA. Seeds match the Rust program exactly:
 *   [b"universe", creator.key().as_ref(), content_hash.as_ref()]
 */
export function deriveUniversePda(
  creator: PublicKey,
  contentHash: Uint8Array
): [PublicKey, number] {
  if (contentHash.length !== 32) {
    throw new Error('contentHash must be 32 bytes');
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from('universe'), creator.toBuffer(), Buffer.from(contentHash)],
    UNIVERSE_PROGRAM_ID
  );
}

/** Singleton config PDA used to gate all mutating ix via the pause flag. */
export function deriveUniverseConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('universe_config')], UNIVERSE_PROGRAM_ID);
}

/** SHA-256 of an arbitrary string → 32-byte content hash. */
export async function sha256Bytes(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

/**
 * Build the raw `initialize_universe` instruction.
 *
 * Layout (Anchor):
 *   [0..8)   = discriminator
 *   [8..40)  = content_hash (32 bytes)
 *   [40..72) = plot_hash (32 bytes)
 *   [72..73) = visibility (1 byte, borsh enum tag)
 */
export function buildInitializeUniverseIx(params: {
  creator: PublicKey;
  contentHash: Uint8Array;
  plotHash: Uint8Array;
  visibility: Visibility;
}): { ix: TransactionInstruction; universePda: PublicKey } {
  if (params.contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');
  if (params.plotHash.length !== 32) throw new Error('plotHash must be 32 bytes');

  const [universePda] = deriveUniversePda(params.creator, params.contentHash);
  const [configPda] = deriveUniverseConfigPda();

  const data = Buffer.alloc(8 + 32 + 32 + 1);
  data.set(INITIALIZE_UNIVERSE_DISCRIMINATOR, 0);
  data.set(params.contentHash, 8);
  data.set(params.plotHash, 40);
  data.writeUInt8(visibilityByte(params.visibility), 72);

  const ix = new TransactionInstruction({
    programId: UNIVERSE_PROGRAM_ID,
    keys: [
      { pubkey: params.creator, isSigner: true, isWritable: true },
      { pubkey: universePda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return { ix, universePda };
}

/** Resolve the connection RPC URL given a cluster. Falls back to clusterApiUrl. */
export function clusterRpcUrl(cluster: UniverseProgramCluster): string {
  const override = import.meta.env.VITE_SOLANA_RPC_URL as string | undefined;
  if (override) return override;
  // clusterApiUrl uses Solana-Labs hosted endpoints — fine for devnet, will be
  // overridden by VITE_SOLANA_RPC_URL (Helius) for mainnet.
  return clusterApiUrl(cluster as Cluster);
}

export function createConnection(cluster: UniverseProgramCluster): Connection {
  return new Connection(clusterRpcUrl(cluster), 'confirmed');
}

/**
 * High-level helper used by `useSolanaUniverseProgram`. Builds the tx, asks
 * the wallet adapter to sign + send, waits for confirmation, returns the
 * signature + PDA.
 *
 * The wallet adapter signature is `signAndSendTransaction` style — we pass
 * the unsigned tx and the wallet handles sign + submit + retry.
 */
export async function initializeUniverse(args: {
  cluster: UniverseProgramCluster;
  creator: PublicKey;
  signAndSend: (tx: Transaction) => Promise<string>;
  contentHash: Uint8Array;
  plotHash: Uint8Array;
  visibility: Visibility;
}): Promise<{ signature: string; universePda: PublicKey; cluster: UniverseProgramCluster }> {
  const connection = createConnection(args.cluster);
  const { ix, universePda } = buildInitializeUniverseIx({
    creator: args.creator,
    contentHash: args.contentHash,
    plotHash: args.plotHash,
    visibility: args.visibility,
  });

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: args.creator, recentBlockhash: blockhash }).add(ix);

  const signature = await args.signAndSend(tx);

  // Wait for confirmation so the server-side `createSolana` call has a
  // finalized signature to record.
  const latest = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed'
  );

  return { signature, universePda, cluster: args.cluster };
}

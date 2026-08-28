/**
 * Episode cNFT mint orchestration.
 *
 * Composes two instructions into a single Circle-signed transaction:
 *   1. episode::mint_episode      — Anchor record of (universe, content_hash, title, uri)
 *   2. bubblegum::mint_v1         — actual cNFT mint into the merkle tree
 *
 * Both share the same fee payer (Circle DCW wallet) and same signer (creator).
 * One tx = atomic: if the cNFT mint fails (e.g. tree full), the EpisodeRecord
 * PDA write is rolled back too.
 *
 * Inputs:
 *   - userId            — the LOAR identity (uid from auth) that owns the wallet
 *   - universeAddress   — base58 Universe PDA address (looked up by frontend)
 *   - contentHash       — 32-byte content hash; matches the EVM bytes32 hash
 *                         used by Universe.sol for cross-chain identity
 *   - metadataUri       — off-chain JSON metadata (ipfs://… or https://…)
 *   - title             — display name (≤64 chars)
 *
 * Returns:
 *   { txSignature, episodePda, leafOwner } so callers can poll for confirmation
 *   and the indexer can join the Bubblegum LeafSchema event to the EpisodeRecord.
 */
import { PublicKey } from '@solana/web3.js';
import {
  activeCluster,
  executeSolanaTransaction,
  getOrCreateSolanaWallet,
} from '../../lib/circle-solana';
import { buildMintEpisodeIx } from '../../lib/anchor-ix';
import { buildMintCnftIx, episodeMetadata } from '../../lib/bubblegum';
import { EpisodeProgram, BubblegumTree, getSolanaAddress } from '@loar/abis/solana-addresses';
import { db, firebaseAvailable } from '../../lib/firebase';
import { signAttestation } from '../../lib/attestation';

/**
 * Optional VLM / content-lineage fields. When supplied, the mint result is
 * mirrored to a `solanaEpisodeLineage/{episodePda}` Firestore doc so off-chain
 * UIs can join cNFT → LOAR content generation → VLM scene index → entities.
 *
 * On-chain we keep the metadata pointer minimal (just the caller's `uri`);
 * the lineage doc is the off-chain joinable layer.
 */
export interface EpisodeLineage {
  /** LOAR content ID (the generation that produced the image/video). */
  contentId?: string;
  /** VLM extraction job that processed the content (links to sceneIndex docs). */
  extractionId?: string;
  /** Scene index within the content (0-based). */
  sceneIndex?: number;
  /** EVM universe address (so judges + integrators can cross-chain reconcile). */
  evmUniverseAddress?: string;
  /** LOAR entity id (when minting on behalf of a wiki entity page). */
  entityId?: string;
}

export interface MintEpisodeRequest {
  userId: string;
  universeAddress: string;
  contentHash: Buffer; // 32 bytes
  metadataUri: string;
  title: string;
  /** Optional off-chain lineage references for VLM / content joins. */
  lineage?: EpisodeLineage;
}

export interface MintEpisodeResult {
  txSignature: string;
  episodePda: string;
  leafOwner: string;
  state: string;
}

export async function mintEpisodeCnft(req: MintEpisodeRequest): Promise<MintEpisodeResult> {
  if (req.contentHash.length !== 32) {
    throw new Error('contentHash must be exactly 32 bytes');
  }

  const cluster = activeCluster();
  const episodeProgramId = new PublicKey(
    getSolanaAddress(EpisodeProgram, cluster, 'EpisodeProgram')
  );
  const merkleTree = new PublicKey(getSolanaAddress(BubblegumTree, cluster, 'BubblegumTree'));

  // Resolve the user's Circle DCW Solana wallet — this signs as creator AND
  // fee payer. For multi-sig universes we'd resolve the universe's owner
  // wallet instead; v1 keeps it 1:1.
  const wallet = await getOrCreateSolanaWallet(req.userId, cluster);
  const creator = new PublicKey(wallet.address);
  const universe = new PublicKey(req.universeAddress);

  // 1. Anchor record ix — also derives the EpisodeRecord PDA.
  const episodeIx = buildMintEpisodeIx({
    programId: episodeProgramId,
    creator,
    universe,
    contentHash: req.contentHash,
    metadataUri: req.metadataUri,
    title: req.title,
  });
  // Last key on the ix list before SystemProgram is the EpisodeRecord PDA —
  // anchor-ix.ts:130 ordering — pull it out so we can return the address.
  const episodePda = episodeIx.keys[2].pubkey;

  // 2. Bubblegum mint_v1 ix — fires the actual compressed-NFT mint.
  const bubblegumIx = buildMintCnftIx({
    merkleTree,
    payer: creator,
    leafOwner: creator,
    treeCreatorOrDelegate: creator,
    metadata: episodeMetadata({
      name: req.title,
      uri: req.metadataUri,
      creators: [{ address: creator, share: 100, verified: true }],
    }),
  });

  // 3. Compose + sign + broadcast.
  const tx = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster,
    instructions: [episodeIx, bubblegumIx],
    // Bubblegum mint ~300k CU; Anchor record ~30k. Headroom for ComputeBudget
    // pre-ixs (added by executeSolanaTransaction) + future creator-attribution
    // ixs gives 500k.
    computeUnitLimit: 500_000,
  });

  // Off-chain lineage doc — written best-effort after the tx confirms.
  // A failure here doesn't undo the mint; the lineage table is recoverable
  // by re-running a reconciler against Firestore + the indexer.
  if (req.lineage && firebaseAvailable) {
    try {
      await db
        .collection('solanaEpisodeLineage')
        .doc(episodePda.toBase58())
        .set(
          {
            episodePda: episodePda.toBase58(),
            universeAddress: req.universeAddress,
            cluster,
            txSignature: tx.signature ?? tx.txId,
            mintedAt: new Date(),
            mintedBy: req.userId,
            ...req.lineage,
          },
          { merge: true }
        );
    } catch (err) {
      console.warn(
        `[episode-mint] lineage write failed for ${episodePda.toBase58()}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Cross-chain attestation — Ed25519 receipt that an external verifier can
  // check offline to confirm "this cNFT corresponds to EVM universe X." Best-
  // effort: signing failures (missing key, etc) don't undo the mint.
  if (firebaseAvailable) {
    try {
      const signed = await signAttestation({
        schema: 'loar-cnft-cross-chain-v1',
        mintedAt: new Date().toISOString(),
        solana: {
          cluster,
          episodePda: episodePda.toBase58(),
          mintTxSignature: tx.signature ?? tx.txId,
        },
        evm: req.lineage?.evmUniverseAddress
          ? {
              chainId: 11155111, // Sepolia for v1; production reads from env
              universeAddress: req.lineage.evmUniverseAddress,
              contentHashHex: '0x' + req.contentHash.toString('hex'),
            }
          : undefined,
        lineage: req.lineage
          ? {
              entityId: req.lineage.entityId,
              contentId: req.lineage.contentId,
              extractionId: req.lineage.extractionId,
              sceneIndex: req.lineage.sceneIndex,
            }
          : undefined,
      });
      await db
        .collection('solanaAttestations')
        .doc(episodePda.toBase58())
        .set(signed, { merge: true });
    } catch (err) {
      console.warn(
        `[episode-mint] attestation write failed for ${episodePda.toBase58()}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    txSignature: tx.signature ?? tx.txId,
    episodePda: episodePda.toBase58(),
    leafOwner: creator.toBase58(),
    state: tx.state,
  };
}

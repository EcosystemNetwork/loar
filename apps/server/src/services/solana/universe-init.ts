/**
 * Initialize a Solana Universe via Circle DCW.
 *
 * Browser calls `POST /api/solana/universe/initialize` with the universe seed
 * data; the server derives the PDA, builds the Anchor ix, and signs+broadcasts
 * with the caller's Circle DCW Solana wallet. Mirrors the canon-promote +
 * episode-mint server flow — no client-side wallet adapter required.
 */
import { PublicKey } from '@solana/web3.js';
import {
  activeCluster,
  executeSolanaTransaction,
  getOrCreateSolanaWallet,
} from '../../lib/circle-solana';
import { buildInitializeUniverseIx, deriveUniversePda, type Visibility } from '../../lib/anchor-ix';
import { UniverseProgram, getSolanaAddress } from '@loar/abis/solana-addresses';
import { createUniverse } from '../../routers/universes/universes.handlers';

export interface InitializeUniverseRequest {
  userId: string;
  /** 32-byte content hash — stable per universe. */
  contentHash: Buffer;
  /** 32-byte plot hash. */
  plotHash: Buffer;
  visibility: Visibility;
  /** Off-chain metadata — persisted alongside the on-chain PDA. */
  name: string;
  imageUrl: string;
  portraitImageUrl?: string;
  description: string;
  /** 'fun' = sandbox (private until publicly launched); 'monetized' = launchpad. */
  universeType?: 'fun' | 'monetized';
}

export interface InitializeUniverseResult {
  txSignature: string;
  universePda: string;
  creator: string;
  cluster: string;
  state: string;
}

export async function initializeSolanaUniverse(
  req: InitializeUniverseRequest
): Promise<InitializeUniverseResult> {
  if (req.contentHash.length !== 32) throw new Error('contentHash must be exactly 32 bytes');
  if (req.plotHash.length !== 32) throw new Error('plotHash must be exactly 32 bytes');

  const cluster = activeCluster();
  const programId = new PublicKey(getSolanaAddress(UniverseProgram, cluster, 'UniverseProgram'));

  const wallet = await getOrCreateSolanaWallet(req.userId, cluster);
  const creator = new PublicKey(wallet.address);

  const [universePda] = deriveUniversePda(programId, creator, req.contentHash);

  const ix = buildInitializeUniverseIx({
    programId,
    creator,
    contentHash: req.contentHash,
    plotHash: req.plotHash,
    visibility: req.visibility,
  });

  const tx = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster,
    instructions: [ix],
    // initialize_universe is a single PDA init — ~50k CU is plenty.
    computeUnitLimit: 80_000,
  });

  const txSignature = tx.signature ?? tx.txId;
  const universePdaB58 = universePda.toBase58();
  const creatorB58 = creator.toBase58();

  // Persist the Firestore mirror. The server is the trust root here — the
  // ix-signing wallet IS the creator, so no further proof is required.
  await createUniverse({
    address: universePdaB58,
    creator: creatorB58,
    name: req.name,
    // Solana universes reuse the PDA for token/governance until the SVM
    // launchpad lands — schema invariant only requires the slots be present.
    tokenAddress: universePdaB58,
    governanceAddress: universePdaB58,
    imageUrl: req.imageUrl,
    portraitImageUrl: req.portraitImageUrl,
    description: req.description,
    mintTxHash: txSignature,
    chainNamespace: 'solana',
    solanaCluster: cluster,
    universeType: req.universeType ?? 'fun',
  });

  return {
    txSignature,
    universePda: universePdaB58,
    creator: creatorB58,
    cluster,
    state: tx.state,
  };
}

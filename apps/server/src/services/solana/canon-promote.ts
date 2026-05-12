/**
 * Canon promotion — flip an Episode's `is_canon` flag and mint a Metaplex Core
 * NFT alongside the existing cNFT.
 *
 * Architectural note:
 *   Bubblegum's `decompress_v1` requires the leaf's proof path + leaf metadata,
 *   which is non-trivial to assemble server-side (needs DAS API getAssetProof
 *   plus a recent merkle root). For canon-promoted episodes we go further:
 *   instead of decompressing the cNFT in place (which retires the leaf),
 *   we mint a *new* Metaplex Core asset that represents the canon-promoted
 *   version. This gives us:
 *
 *     - cNFT: stays in the holder's wallet as historical "minted by creator"
 *             record (cheap, mass-storable)
 *     - Core NFT: high-value canon asset, marketplace-tradable on Tensor/ME
 *
 *   The Core asset references the cNFT's assetId in its plugin metadata so
 *   off-chain UIs can link them. If the team later wants strict decompression
 *   semantics (cNFT → regular NFT with the same address), swap in the
 *   `decompress_v1` CPI here.
 *
 * Flow (one atomic tx):
 *   1. episode::canonize     — Anchor flag flip + EpisodeCanonized event
 *   2. mpl_core::createV1    — mint Core asset, owner = episode creator
 */
import { PublicKey, Keypair } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { create as createCore, ruleSet } from '@metaplex-foundation/mpl-core';
import {
  generateSigner,
  publicKey as toUmiPublicKey,
  type Umi,
  type Instruction as UmiInstruction,
} from '@metaplex-foundation/umi';
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import {
  activeCluster,
  executeSolanaTransaction,
  getOrCreateSolanaWallet,
} from '../../lib/circle-solana';
import { buildCanonizeEpisodeIx, deriveEpisodeRecordPda } from '../../lib/anchor-ix';
import { EpisodeProgram, getSolanaAddress } from '@loar/abis/solana-addresses';

let _umi: Umi | null = null;
function getUmi(): Umi {
  if (_umi) return _umi;
  const url = process.env.SOLANA_RPC_URL;
  if (!url) throw new Error('SOLANA_RPC_URL is required for canon promotion');
  _umi = createUmi(url);
  return _umi;
}

export interface CanonizeRequest {
  userId: string;
  universeAddress: string;
  /** 32-byte content hash for the episode being canonized. */
  contentHash: Buffer;
  /** Off-chain metadata URI for the Core NFT (often the same as the cNFT). */
  metadataUri: string;
  /** Display name of the canon Core asset. */
  name: string;
  /** Optional reference to the original cNFT assetId for off-chain linking. */
  cnftAssetId?: string;
}

export interface CanonizeResult {
  txSignature: string;
  episodePda: string;
  coreAsset: string;
  state: string;
}

export async function canonizeEpisode(req: CanonizeRequest): Promise<CanonizeResult> {
  if (req.contentHash.length !== 32) {
    throw new Error('contentHash must be exactly 32 bytes');
  }

  const cluster = activeCluster();
  const episodeProgramId = new PublicKey(
    getSolanaAddress(EpisodeProgram, cluster, 'EpisodeProgram')
  );

  const wallet = await getOrCreateSolanaWallet(req.userId, cluster);
  const signer = new PublicKey(wallet.address);
  const universe = new PublicKey(req.universeAddress);

  const [episodePda] = deriveEpisodeRecordPda(episodeProgramId, universe, req.contentHash);

  // 1. Anchor canonize ix — flips is_canon and emits EpisodeCanonized event.
  const canonIx = buildCanonizeEpisodeIx({
    programId: episodeProgramId,
    signer,
    episodeRecord: episodePda,
  });

  // 2. Metaplex Core createV1 ix — fresh asset keypair, owner = signer.
  // The asset address is the keypair's pubkey; cache it for return.
  const umi = getUmi();
  const coreAsset = generateSigner(umi);

  // Plugin: 5% royalty to the creator. Modern `create` accepts flat V2-shaped
  // plugin args (no `plugin: { ... }` wrapping). Production: extend with an
  // `Attributes` plugin that pins cnftAssetId for off-chain linking.
  const dummySigner = {
    publicKey: toUmiPublicKey(signer.toBase58()),
    signMessage: async () => {
      throw new Error('signer not used — server signs via Circle DCW after ix-building');
    },
    signTransaction: async () => {
      throw new Error('signer not used — server signs via Circle DCW after ix-building');
    },
    signAllTransactions: async () => {
      throw new Error('signer not used — server signs via Circle DCW after ix-building');
    },
  } as const;

  const builder = createCore(umi, {
    asset: coreAsset,
    name: req.name.slice(0, 64),
    uri: req.metadataUri,
    owner: toUmiPublicKey(signer.toBase58()),
    payer: dummySigner,
    plugins: [
      {
        type: 'Royalties',
        basisPoints: 500, // 5%
        creators: [{ address: toUmiPublicKey(signer.toBase58()), percentage: 100 }],
        ruleSet: ruleSet('None'),
      },
    ],
  });

  const umiIxs = builder.getInstructions();
  if (umiIxs.length === 0) {
    throw new Error('mpl-core createV1 produced no instructions');
  }
  const coreIxs = umiIxs.map((i) => toWeb3JsInstruction(i as UmiInstruction));

  // The Core asset must sign as a fresh account during init. We pass its
  // keypair as an additional signer to executeSolanaTransaction; the Circle
  // wallet signs as fee payer.
  const additionalSigners = [
    {
      publicKey: new PublicKey(coreAsset.publicKey),
      secretKey: coreAsset.secretKey,
    } as unknown as Keypair, // Keypair-compatible shape; executeSolanaTransaction calls .sign on it
  ];

  const tx = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster,
    instructions: [canonIx, ...coreIxs],
    additionalSigners,
    computeUnitLimit: 500_000,
  });

  return {
    txSignature: tx.signature ?? tx.txId,
    episodePda: episodePda.toBase58(),
    coreAsset: coreAsset.publicKey,
    state: tx.state,
  };
}

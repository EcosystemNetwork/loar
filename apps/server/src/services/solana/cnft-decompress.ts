/**
 * Bubblegum cNFT decompression — turn a compressed leaf into a regular SPL
 * Token Metadata NFT.
 *
 * Two-tx flow per Bubblegum spec:
 *   tx1 — redeem(asset, proof) → creates a voucher PDA, retires the leaf
 *   tx2 — decompressV1(voucher) → mints the standard NFT under that voucher
 *
 * Single-tx composition isn't safe because the merkle proof must be loaded
 * with the redeem ix (the tree state changes after redeem, so a second ix
 * in the same tx would see a stale proof). Hence the route exposes only
 * the redeem step here; the decompress half lands in v2 alongside a
 * post-redeem worker that finalizes the mint asynchronously.
 *
 * For the "canon-promoted asset that's marketplace-tradable" use case TODAY,
 * see canon-promote.ts which mints a parallel Metaplex Core asset without
 * retiring the cNFT — simpler and atomic.
 */
import { PublicKey } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api';
import { getAssetWithProof, redeem } from '@metaplex-foundation/mpl-bubblegum';
import {
  publicKey as toUmiPublicKey,
  type Umi,
  type Instruction as UmiInstruction,
} from '@metaplex-foundation/umi';
import type { DasApiInterface } from '@metaplex-foundation/digital-asset-standard-api';

/**
 * Umi shape after `.use(dasApi())`. The plugin adds DAS methods to umi.rpc
 * at runtime, but the package doesn't ship a module augmentation, so we
 * narrow manually here. Functions like `getAssetWithProof` require this.
 */
type UmiWithDas = Umi & { rpc: Umi['rpc'] & DasApiInterface };
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import {
  activeCluster,
  executeSolanaTransaction,
  getOrCreateSolanaWallet,
} from '../../lib/circle-solana';

let _umi: UmiWithDas | null = null;
function getUmi(): UmiWithDas {
  if (_umi) return _umi;
  const url = process.env.SOLANA_RPC_URL;
  if (!url) throw new Error('SOLANA_RPC_URL is required for cNFT decompression');
  // dasApi plugin adds rpc.getAsset / getAssetProof / etc — required by
  // getAssetWithProof. The cast narrows the type since the plugin doesn't
  // ship a module augmentation on Umi.
  _umi = createUmi(url).use(dasApi()) as UmiWithDas;
  return _umi;
}

export class CnftDecompressError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'NOT_OWNER' | 'ALREADY_REDEEMED',
    message: string
  ) {
    super(message);
    this.name = 'CnftDecompressError';
  }
}

export interface DecompressRequest {
  userId: string;
  cnftAssetId: string;
}

export interface DecompressResult {
  txSignature: string;
  /** Voucher PDA created by redeem — used by the decompress finalizer (v2). */
  voucherPda?: string;
  state: string;
  /** When true, the next step (decompressV1 against the voucher) is queued for v2. */
  awaitingDecompress: boolean;
}

/**
 * Redeem step. Burns the cNFT leaf and produces a voucher PDA the user owns.
 * The voucher can later be cashed in for an SPL Token Metadata NFT via
 * decompressV1 (or cancel-redeemed back to a cNFT, if mistakenly redeemed).
 *
 * Permission: only the leaf owner can redeem — checked here by comparing the
 * caller's Circle DCW Solana wallet to the asset's leafOwner from DAS.
 */
export async function decompressCnft(req: DecompressRequest): Promise<DecompressResult> {
  const cluster = activeCluster();
  const wallet = await getOrCreateSolanaWallet(req.userId, cluster);
  const ownerWeb3 = new PublicKey(wallet.address);
  const umi = getUmi();

  // mpl-bubblegum bundles a slightly different `Context` shape than our
  // top-level Umi types — the `rpc` field unification is the load-bearing
  // bit, which the dasApi plugin guarantees at runtime. Cast at the call
  // boundary so TS isn't tripped by the structural mismatch.
  let assetWithProof: Awaited<ReturnType<typeof getAssetWithProof>>;
  try {
    assetWithProof = await getAssetWithProof(
      umi as Parameters<typeof getAssetWithProof>[0],
      toUmiPublicKey(req.cnftAssetId)
    );
  } catch (err) {
    throw new CnftDecompressError(
      'NOT_FOUND',
      `cNFT ${req.cnftAssetId} not found via DAS: ${err instanceof Error ? err.message : err}`
    );
  }

  if (assetWithProof.leafOwner.toString() !== ownerWeb3.toBase58()) {
    throw new CnftDecompressError(
      'NOT_OWNER',
      `Caller wallet ${ownerWeb3.toBase58()} is not the leaf owner (${assetWithProof.leafOwner})`
    );
  }

  // Build the redeem ix. The leafOwner signer is a dummy — Circle DCW signs
  // the actual tx as the fee payer (who must also be the leaf owner).
  const builder = redeem(
    umi as Parameters<typeof redeem>[0],
    {
      ...assetWithProof,
      leafOwner: {
        publicKey: toUmiPublicKey(ownerWeb3.toBase58()),
        signMessage: async () => {
          throw new Error('signer not used — Circle DCW signs as the leaf owner');
        },
        signTransaction: async () => {
          throw new Error('signer not used — Circle DCW signs as the leaf owner');
        },
        signAllTransactions: async () => {
          throw new Error('signer not used — Circle DCW signs as the leaf owner');
        },
      },
    } as Parameters<typeof redeem>[1]
  );

  const umiIxs = builder.getInstructions();
  if (umiIxs.length === 0) {
    throw new Error('mpl-bubblegum redeem produced no instructions');
  }
  const ixs = umiIxs.map((i) => toWeb3JsInstruction(i as UmiInstruction));

  const tx = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster,
    instructions: ixs,
    computeUnitLimit: 400_000,
  });

  return {
    txSignature: tx.signature ?? tx.txId,
    state: tx.state,
    awaitingDecompress: true,
  };
}

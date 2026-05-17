/**
 * Tensor adapter — secondary marketplace for cNFTs (and Metaplex Core assets).
 *
 * Tensor enforces Metaplex Core royalty plugins natively, so LOAR creator
 * royalties on episode + character NFTs are honored on every secondary sale
 * without us having to wire ERC2981-style enforcement ourselves (vs the EVM
 * SlopMarket port).
 *
 * Required env:
 *   TENSOR_PROGRAM_ID — optional override
 *   TENSOR_API_KEY    — for the off-chain quote/listing endpoints
 */
import { PublicKey } from '@solana/web3.js';
import { resolveUserSolanaWallet, sendNativeTx, extractInstructions } from './native-base';
import { isCircleSolanaConfigured } from './circle-solana';
import { getTensorProgramId } from './native-registry';

export function isTensorConfigured(): boolean {
  return isCircleSolanaConfigured() && !!process.env.TENSOR_API_KEY;
}

function tensorApiBase(): string {
  return process.env.TENSOR_API_BASE ?? 'https://api.tensor.so';
}

async function tensorFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.TENSOR_API_KEY;
  if (!apiKey) throw new Error('TENSOR_API_KEY not set');
  const resp = await fetch(`${tensorApiBase()}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-tensor-api-key': apiKey },
  });
  if (!resp.ok) {
    throw new Error(`Tensor ${path} failed: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as T;
}

// ── List a cNFT for sale ────────────────────────────────────────────────────

export interface ListCnftArgs {
  sellerUserId: string;
  /** Compressed NFT asset ID (Bubblegum). */
  assetId: PublicKey;
  /** Price in lamports. */
  priceLamports: bigint;
}

export interface ListCnftResult {
  txId: string;
  signature?: string;
  listingId: string;
  state: string;
}

export async function listCnft(args: ListCnftArgs): Promise<ListCnftResult> {
  if (!isTensorConfigured()) throw new Error('tensor not configured');
  const wallet = await resolveUserSolanaWallet(args.sellerUserId);

  // Tensor's list endpoint returns a serialized tx for the seller to sign.
  const resp = await tensorFetch<{
    tx: string; // base64 VersionedTransaction
    listingId: string;
  }>('/api/v1/tx/cnft/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seller: wallet.pubkey.toBase58(),
      mint: args.assetId.toBase58(),
      price: args.priceLamports.toString(),
    }),
  });

  const { VersionedTransaction } = await import('@solana/web3.js');
  const tx = VersionedTransaction.deserialize(Buffer.from(resp.tx, 'base64'));
  const instructions = extractInstructions(tx);

  const result = await sendNativeTx({
    userId: args.sellerUserId,
    instructions,
    computeUnitLimit: 400_000,
  });

  return {
    txId: result.txId,
    signature: result.signature,
    listingId: resp.listingId,
    state: result.state,
  };
}

// ── Buy a listed cNFT ───────────────────────────────────────────────────────

export interface BuyCnftArgs {
  buyerUserId: string;
  listingId: string;
  /** Max price buyer accepts (slippage protection). */
  maxPriceLamports: bigint;
}

export async function buyCnft(
  args: BuyCnftArgs
): Promise<{ txId: string; signature?: string; state: string }> {
  if (!isTensorConfigured()) throw new Error('tensor not configured');
  const wallet = await resolveUserSolanaWallet(args.buyerUserId);

  const resp = await tensorFetch<{ tx: string }>('/api/v1/tx/cnft/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      buyer: wallet.pubkey.toBase58(),
      listingId: args.listingId,
      maxPrice: args.maxPriceLamports.toString(),
    }),
  });

  const { VersionedTransaction } = await import('@solana/web3.js');
  const tx = VersionedTransaction.deserialize(Buffer.from(resp.tx, 'base64'));
  const instructions = extractInstructions(tx);

  return sendNativeTx({
    userId: args.buyerUserId,
    instructions,
    computeUnitLimit: 600_000,
  });
}

// ── Cancel a listing ────────────────────────────────────────────────────────

export async function cancelListing(args: {
  sellerUserId: string;
  listingId: string;
}): Promise<{ txId: string; signature?: string; state: string }> {
  if (!isTensorConfigured()) throw new Error('tensor not configured');
  const wallet = await resolveUserSolanaWallet(args.sellerUserId);
  const resp = await tensorFetch<{ tx: string }>('/api/v1/tx/cnft/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seller: wallet.pubkey.toBase58(),
      listingId: args.listingId,
    }),
  });
  const { VersionedTransaction } = await import('@solana/web3.js');
  const tx = VersionedTransaction.deserialize(Buffer.from(resp.tx, 'base64'));
  return sendNativeTx({
    userId: args.sellerUserId,
    instructions: extractInstructions(tx),
    computeUnitLimit: 200_000,
  });
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface DecodedListing {
  listingId: string;
  assetId: string;
  seller: string;
  priceLamports: bigint;
  active: boolean;
}

export async function readListing(listingId: string): Promise<DecodedListing | null> {
  try {
    const resp = await tensorFetch<DecodedListing>(`/api/v1/listings/${listingId}`);
    return { ...resp, priceLamports: BigInt(resp.priceLamports as unknown as string) };
  } catch {
    return null;
  }
}

export async function readListingsByOwner(owner: PublicKey): Promise<DecodedListing[]> {
  const resp = await tensorFetch<{ listings: DecodedListing[] }>(
    `/api/v1/listings/by-owner/${owner.toBase58()}`
  );
  return resp.listings.map((l) => ({
    ...l,
    priceLamports: BigInt(l.priceLamports as unknown as string),
  }));
}

// Reference so the import isn't dropped.
void getTensorProgramId;

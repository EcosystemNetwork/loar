/**
 * Magic Eden adapter — fallback liquidity source for cNFT secondary market.
 *
 * Tensor is the primary cNFT marketplace per the PRD; this adapter exists
 * so we can route to ME for liquidity comparison and as a backup if Tensor
 * has reliability issues. Same surface shape as native-tensor.ts.
 *
 * Required env:
 *   MAGIC_EDEN_API_KEY — for off-chain endpoints
 *   MAGIC_EDEN_PROGRAM_ID — optional override
 */
import {
  type AddressLookupTableAccount,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { resolveUserSolanaWallet, sendNativeTx, extractInstructions } from './native-base';
import { activeCluster, getSolanaConnection, isCircleSolanaConfigured } from './circle-solana';
import { getMagicEdenProgramId } from './native-registry';

/**
 * H-5 (NIT mirror — mainnet-gated): For v0 messages, ALT-sourced accounts
 * must be resolved with the SDK's `TransactionMessage.decompile` path so
 * signer/writable flags survive. The legacy `extractInstructions` helper
 * only inspects the static header and silently downgrades any account that
 * came in via an Address Lookup Table to `isSigner=false, isWritable=false`,
 * which breaks ME txs that route through ALTs.
 *
 * This helper resolves the ALTs from the cluster, then either decompiles
 * (v0) or falls back to the cheap legacy path (legacy messages — no ALTs
 * by definition).
 */
async function resolveInstructionsWithAlts(
  tx: VersionedTransaction
): Promise<{ instructions: TransactionInstruction[]; lookupTables: AddressLookupTableAccount[] }> {
  const lookupTableKeys = tx.message.addressTableLookups.map((l) => l.accountKey);

  // For legacy messages there are no ALT lookups — fast path.
  if (tx.message.version !== 0) {
    if (lookupTableKeys.length > 0) {
      // Shouldn't happen (legacy + ALT is invalid), but defend against it.
      throw new Error(
        'Magic Eden returned a legacy tx with addressTableLookups — refusing to extract'
      );
    }
    return { instructions: extractInstructions(tx), lookupTables: [] };
  }

  const conn = getSolanaConnection();
  const lookupTables = await Promise.all(
    lookupTableKeys.map(async (key) => {
      const result = await conn.getAddressLookupTable(key);
      if (!result.value) throw new Error(`Failed to load ALT ${key.toBase58()}`);
      return result.value;
    })
  );
  const instructions = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: lookupTables,
  }).instructions;
  return { instructions, lookupTables };
}

export function isMagicEdenConfigured(): boolean {
  return isCircleSolanaConfigured() && !!process.env.MAGIC_EDEN_API_KEY;
}

/**
 * H-7: Magic Eden's HTTP API and the on-chain ME program only exist on
 * mainnet-beta. Calling any ME endpoint on devnet/testnet either fails with a
 * confusing 404 from ME's API or — worse — builds a mainnet-targeted tx that
 * gets signed by a devnet wallet and silently no-ops. Hard fail at the
 * adapter boundary so devnet/testnet integrators see a clear error.
 */
function assertMainnet(): void {
  const cluster = activeCluster();
  if (cluster !== 'mainnet-beta') {
    throw new Error(`Magic Eden adapter only supports mainnet-beta (active cluster: ${cluster})`);
  }
}

function meApiBase(): string {
  return process.env.MAGIC_EDEN_API_BASE ?? 'https://api-mainnet.magiceden.dev/v2';
}

async function meFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.MAGIC_EDEN_API_KEY;
  if (!apiKey) throw new Error('MAGIC_EDEN_API_KEY not set');
  const resp = await fetch(`${meApiBase()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!resp.ok) {
    throw new Error(`Magic Eden ${path} failed: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as T;
}

export interface ListCnftArgs {
  sellerUserId: string;
  assetId: PublicKey;
  priceLamports: bigint;
}

export async function listCnft(
  args: ListCnftArgs
): Promise<{ txId: string; signature?: string; listingId: string; state: string }> {
  if (!isMagicEdenConfigured()) throw new Error('magic_eden not configured');
  assertMainnet();
  const wallet = await resolveUserSolanaWallet(args.sellerUserId);
  const resp = await meFetch<{ txSigned: string; listingPda: string }>(
    `/instructions/list_compressed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seller: wallet.pubkey.toBase58(),
        assetId: args.assetId.toBase58(),
        price: args.priceLamports.toString(),
      }),
    }
  );
  const tx = VersionedTransaction.deserialize(Buffer.from(resp.txSigned, 'base64'));
  const { instructions, lookupTables } = await resolveInstructionsWithAlts(tx);
  const result = await sendNativeTx({
    userId: args.sellerUserId,
    instructions,
    lookupTables,
    computeUnitLimit: 400_000,
  });
  return {
    txId: result.txId,
    signature: result.signature,
    listingId: resp.listingPda,
    state: result.state,
  };
}

export async function buyCnft(args: {
  buyerUserId: string;
  listingId: string;
  maxPriceLamports: bigint;
}): Promise<{ txId: string; signature?: string; state: string }> {
  if (!isMagicEdenConfigured()) throw new Error('magic_eden not configured');
  assertMainnet();
  const wallet = await resolveUserSolanaWallet(args.buyerUserId);
  const resp = await meFetch<{ txSigned: string }>(`/instructions/buy_compressed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      buyer: wallet.pubkey.toBase58(),
      listingPda: args.listingId,
      maxPrice: args.maxPriceLamports.toString(),
    }),
  });
  const tx = VersionedTransaction.deserialize(Buffer.from(resp.txSigned, 'base64'));
  const { instructions, lookupTables } = await resolveInstructionsWithAlts(tx);
  return sendNativeTx({
    userId: args.buyerUserId,
    instructions,
    lookupTables,
    computeUnitLimit: 600_000,
  });
}

export async function cancelListing(args: {
  sellerUserId: string;
  listingId: string;
}): Promise<{ txId: string; signature?: string; state: string }> {
  if (!isMagicEdenConfigured()) throw new Error('magic_eden not configured');
  assertMainnet();
  const wallet = await resolveUserSolanaWallet(args.sellerUserId);
  const resp = await meFetch<{ txSigned: string }>(`/instructions/cancel_compressed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seller: wallet.pubkey.toBase58(),
      listingPda: args.listingId,
    }),
  });
  const tx = VersionedTransaction.deserialize(Buffer.from(resp.txSigned, 'base64'));
  const { instructions, lookupTables } = await resolveInstructionsWithAlts(tx);
  return sendNativeTx({
    userId: args.sellerUserId,
    instructions,
    lookupTables,
    computeUnitLimit: 200_000,
  });
}

void getMagicEdenProgramId;

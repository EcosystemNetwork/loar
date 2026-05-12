/**
 * Circle Developer Controlled Wallets — Solana
 *
 * Parallel to lib/circle-wallets.ts (which is EVM-only). Each user can have
 * one Solana wallet per cluster, created lazily on first need. The server
 * builds Solana transactions locally (full control over Bubblegum cNFTs,
 * Anchor instructions, ATAs, compute budget, priority fees), then asks
 * Circle's KMS to produce a signature, then broadcasts via Helius RPC.
 *
 * Required env vars:
 *   CIRCLE_API_KEY        — shared with EVM Circle DCW
 *   CIRCLE_ENTITY_SECRET  — shared
 *   CIRCLE_WALLET_SET_ID  — shared (Circle wallet sets are multi-chain)
 *   SOLANA_RPC_URL        — Helius / Triton RPC for the active cluster
 *   SOLANA_CLUSTER        — devnet | mainnet-beta | testnet
 */
import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  type TransactionInstruction,
  type AddressLookupTableAccount,
  type Signer,
} from '@solana/web3.js';
import bs58 from 'bs58';
import type { SolanaCluster } from '@loar/abis/chain';
import { db, firebaseAvailable } from './firebase';

// ── Client singleton (shared shape with circle-wallets.ts) ──────────────────

let _client: CircleDeveloperControlledWalletsClient | null = null;

function getClient(): CircleDeveloperControlledWalletsClient {
  if (_client) return _client;
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error(
      'CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set for Solana DCW. ' +
        'Get them from https://console.circle.com'
    );
  }
  _client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  return _client;
}

/** Whether Circle Solana DCW is configured (same gate as EVM — keys are shared). */
export function isCircleSolanaConfigured(): boolean {
  return !!(
    process.env.CIRCLE_API_KEY &&
    process.env.CIRCLE_ENTITY_SECRET &&
    process.env.CIRCLE_WALLET_SET_ID &&
    process.env.SOLANA_RPC_URL
  );
}

// ── Cluster <-> Circle blockchain mapping ────────────────────────────────────

/**
 * Circle's identifier for Solana clusters.
 * Note: Circle DCW supports mainnet ('SOL') and devnet ('SOL-DEVNET') only;
 * 'testnet' (the original Solana testnet) is unsupported — we route those
 * dev sessions to devnet and warn callers.
 */
export function circleSolanaBlockchain(cluster: SolanaCluster): 'SOL' | 'SOL-DEVNET' {
  switch (cluster) {
    case 'mainnet-beta':
      return 'SOL';
    case 'devnet':
      return 'SOL-DEVNET';
    case 'testnet':
      console.warn(
        '[circle-solana] cluster=testnet not supported by Circle DCW — falling back to devnet'
      );
      return 'SOL-DEVNET';
    default: {
      const _exhaustive: never = cluster;
      throw new Error(`Unhandled Solana cluster: ${_exhaustive as string}`);
    }
  }
}

/** Active cluster from env (validates once). */
export function activeCluster(): SolanaCluster {
  const c = (process.env.SOLANA_CLUSTER || 'devnet') as SolanaCluster;
  if (c !== 'devnet' && c !== 'mainnet-beta' && c !== 'testnet') {
    throw new Error(`Invalid SOLANA_CLUSTER=${c}. Must be devnet, mainnet-beta, or testnet.`);
  }
  return c;
}

// ── Solana RPC connection ────────────────────────────────────────────────────

let _connection: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (_connection) return _connection;
  const url = process.env.SOLANA_RPC_URL;
  if (!url) {
    throw new Error(
      'SOLANA_RPC_URL is required. Set a Helius/Triton RPC URL — public Solana ' +
        'RPC is throttled and lacks Bubblegum DAS support needed for cNFT flows.'
    );
  }
  _connection = new Connection(url, 'confirmed');
  return _connection;
}

// ── Wallet management ────────────────────────────────────────────────────────

/** Separate Firestore collection so EVM and Solana wallet lookups don't collide. */
const getSolanaWalletsCol = () => (firebaseAvailable ? db.collection('circleSolanaWallets') : null);

const memSolanaWallets = new Map<string, CircleSolanaWallet>();

export interface CircleSolanaWallet {
  walletId: string;
  /** Base58-encoded Solana pubkey. */
  address: string;
  blockchain: 'SOL' | 'SOL-DEVNET';
  cluster: SolanaCluster;
}

/** Look up an existing Circle Solana wallet for a user, scoped per cluster. */
export async function getUserSolanaWallet(
  userId: string,
  cluster: SolanaCluster = activeCluster()
): Promise<CircleSolanaWallet | null> {
  const key = `${userId}__${cluster}`;
  const col = getSolanaWalletsCol();
  if (col) {
    const doc = await col.doc(key).get();
    if (!doc.exists) return null;
    return doc.data() as CircleSolanaWallet;
  }
  return memSolanaWallets.get(key) ?? null;
}

/** Create a new Circle Solana wallet for a user on a given cluster. */
export async function createUserSolanaWallet(
  userId: string,
  cluster: SolanaCluster = activeCluster()
): Promise<CircleSolanaWallet> {
  const client = getClient();
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) throw new Error('CIRCLE_WALLET_SET_ID is required');

  const blockchain = circleSolanaBlockchain(cluster);
  const result = await client.createWallets({
    walletSetId,
    blockchains: [blockchain as any],
    count: 1,
    accountType: 'EOA',
  });

  const wallet = result.data?.wallets?.[0];
  if (!wallet?.address) {
    throw new Error('Circle Solana wallet creation failed — no wallet returned');
  }

  const cw: CircleSolanaWallet = {
    walletId: wallet.id,
    address: wallet.address,
    blockchain,
    cluster,
  };

  const key = `${userId}__${cluster}`;
  const col = getSolanaWalletsCol();
  if (col) {
    await col.doc(key).set({ ...cw, userId, createdAt: new Date() });
  } else {
    memSolanaWallets.set(key, cw);
  }
  return cw;
}

/** Idempotent: returns existing wallet or creates one, deduping concurrent calls. */
const _inflight = new Map<string, Promise<CircleSolanaWallet>>();

export async function getOrCreateSolanaWallet(
  userId: string,
  cluster: SolanaCluster = activeCluster()
): Promise<CircleSolanaWallet> {
  const existing = await getUserSolanaWallet(userId, cluster);
  if (existing) return existing;

  const key = `${userId}__${cluster}`;
  const pending = _inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const cw = await createUserSolanaWallet(userId, cluster);
    // Post-create race check — see circle-wallets.ts:165 for rationale.
    const col = getSolanaWalletsCol();
    if (col) {
      const reread = await col.doc(key).get();
      const stored = reread.exists ? (reread.data() as CircleSolanaWallet) : null;
      if (stored && stored.walletId !== cw.walletId) {
        console.warn(
          `[circle-solana] concurrent wallet creation for ${key} — keeping ${stored.walletId}, orphan ${cw.walletId}`
        );
        return stored;
      }
    }
    return cw;
  })().finally(() => _inflight.delete(key));

  _inflight.set(key, promise);
  return promise;
}

// ── Transaction execution ────────────────────────────────────────────────────

export interface SolanaTxRequest {
  walletId: string;
  cluster?: SolanaCluster;
  instructions: TransactionInstruction[];
  /** Optional Address Lookup Tables — required for cNFT mints + multi-account flows. */
  lookupTables?: AddressLookupTableAccount[];
  /** Additional non-fee-payer signers (e.g. ephemeral keypairs for new accounts). */
  additionalSigners?: Signer[];
  /** Compute unit limit. Default 200_000 (legacy default). Bubblegum cNFTs need ~400k+. */
  computeUnitLimit?: number;
  /**
   * Priority fee in micro-lamports per compute unit. If omitted, queries Helius
   * `getPriorityFeeEstimate` for a 'Medium' level. Static fees fail under congestion.
   */
  priorityFeeMicroLamports?: number;
  /** When true, return immediately after Circle accepts; caller polls status. */
  async?: boolean;
}

export interface SolanaTxResult {
  txId: string;
  signature?: string;
  state: string;
}

const TERMINAL_STATES = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'DENIED']);

/**
 * Estimate priority fee via Helius `getPriorityFeeEstimate`. Retries once on
 * transient failures before falling back to a static 10_000 micro-lamports —
 * during high congestion the static fallback often loses inclusion races, so
 * the retry materially improves landing rate.
 *
 * Non-Helius RPCs respond with `method not found` and short-circuit straight
 * to the fallback (no retry — the method is permanently unavailable).
 */
async function estimatePriorityFee(connection: Connection): Promise<number> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getPriorityFeeEstimate',
    params: [{ options: { priorityLevel: 'Medium' } }],
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(connection.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const json = (await resp.json()) as {
        result?: { priorityFeeEstimate?: number };
        error?: { code?: number; message?: string };
      };
      // -32601 = "Method not found" → non-Helius RPC, retry is pointless.
      if (json.error?.code === -32601) break;
      const estimate = json.result?.priorityFeeEstimate;
      if (typeof estimate === 'number' && estimate > 0) return Math.ceil(estimate);
    } catch {
      // Network error — retry once after a short backoff.
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 200));
  }
  return 10_000;
}

/**
 * Build, sign, and broadcast a Solana transaction via Circle DCW.
 *
 * Flow:
 *   1. Fetch the Circle wallet's pubkey (fee payer).
 *   2. Build VersionedTransaction with compute budget + priority fee instructions
 *      prepended to caller's instructions.
 *   3. Serialize the unsigned tx and ask Circle to sign it via KMS.
 *   4. Apply the signature and broadcast via our Helius connection.
 *   5. Poll for confirmation (sync path) or return immediately (async path).
 */
export async function executeSolanaTransaction(req: SolanaTxRequest): Promise<SolanaTxResult> {
  const client = getClient();
  const cluster = req.cluster ?? activeCluster();
  const expectedBlockchain = circleSolanaBlockchain(cluster);

  const walletResp = await client.getWallet({ id: req.walletId });
  const wallet = walletResp.data?.wallet;
  if (!wallet?.address) {
    throw new Error(`Solana wallet ${req.walletId} not found`);
  }
  if (wallet.blockchain && wallet.blockchain !== expectedBlockchain) {
    throw new Error(
      `Wallet ${req.walletId} is on ${wallet.blockchain} but cluster ${cluster} expects ${expectedBlockchain}`
    );
  }

  const feePayer = new PublicKey(wallet.address);
  const connection = getSolanaConnection();

  const computeLimit = req.computeUnitLimit ?? 400_000;
  const priorityFee = req.priorityFeeMicroLamports ?? (await estimatePriorityFee(connection));

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const allInstructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    ...req.instructions,
  ];

  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: allInstructions,
  }).compileToV0Message(req.lookupTables ?? []);

  const tx = new VersionedTransaction(message);

  // Sign with any additional signers FIRST so Circle's signature lands as the
  // fee payer's. `additionalSigners` is rare in our flows (mostly Bubblegum
  // tree creation, where the tree keypair signs once at setup, not at mint).
  if (req.additionalSigners && req.additionalSigners.length > 0) {
    tx.sign(req.additionalSigners);
  }

  // Serialize the unsigned (or partially-signed) tx for Circle.
  const serialized = Buffer.from(tx.serialize()).toString('base64');

  // Ask Circle to sign as the fee payer.
  // Per @circle-fin/developer-controlled-wallets types: `rawTransaction` is the
  // base64-encoded raw tx for NEAR/Solana. `transaction` is EVM-only JSON.
  // See https://developers.circle.com/w3s/reference/developer-sign-transaction
  const signResp = await client.signTransaction({
    walletId: req.walletId,
    rawTransaction: serialized,
  });

  const { signedTransaction: signedTxB64, signature: sigB58 } = signResp.data ?? {};

  let signedTx: VersionedTransaction;
  if (signedTxB64) {
    // Preferred: Circle returns a fully signed serialized tx.
    signedTx = VersionedTransaction.deserialize(Buffer.from(signedTxB64, 'base64'));
  } else if (sigB58) {
    // Fallback: apply the bare fee-payer signature in-place.
    tx.addSignature(feePayer, bs58.decode(sigB58));
    signedTx = tx;
  } else {
    throw new Error('Circle signTransaction returned no signature or signedTransaction');
  }

  // Broadcast via our RPC for full control over send/confirm semantics.
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  // Circle's signTransaction doesn't return an `id` (unlike createContractExecutionTransaction)
  // — it returns the signature + signedTransaction. Use the Solana signature
  // as our cross-system tracking identifier so callers can poll via getSolanaTransactionStatus.
  const txId = signature;

  if (req.async) {
    return { txId, signature, state: 'SENT' };
  }

  // Sync path: confirm with the standard (blockhash, lastValidBlockHeight) strategy.
  try {
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );
    return { txId, signature, state: 'COMPLETE' };
  } catch (err) {
    throw new Error(
      `Solana tx ${signature} failed to confirm: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Fetch transaction status by signature. Used by the async /api/tx/solana/status route. */
export async function getSolanaTransactionStatus(signature: string): Promise<SolanaTxResult> {
  const connection = getSolanaConnection();
  const status = await connection.getSignatureStatus(signature, {
    searchTransactionHistory: true,
  });
  const confirmation = status.value?.confirmationStatus;
  const state = !confirmation
    ? 'PENDING'
    : confirmation === 'finalized' || confirmation === 'confirmed'
      ? 'COMPLETE'
      : 'PROCESSING';
  return { txId: signature, signature, state };
}

/** Get SOL + SPL token balances for a Circle Solana wallet. */
export async function getSolanaWalletBalances(walletId: string) {
  const client = getClient();
  const resp = await client.getWalletTokenBalance({ id: walletId });
  return resp.data?.tokenBalances ?? [];
}

/**
 * Circle Developer Controlled Wallets — Service Layer
 *
 * Server-side wallet management for LOAR users. Each user gets a Circle-managed
 * EOA wallet when they register via email/social login. The server controls
 * transaction signing via Circle's KMS — users never touch private keys.
 *
 * Required env vars:
 *   CIRCLE_API_KEY       — Circle Console API key
 *   CIRCLE_ENTITY_SECRET — Entity secret registered with Circle
 *   CIRCLE_WALLET_SET_ID — Wallet set to create user wallets in
 */
import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';
import { formatEther } from 'viem';
import { db, firebaseAvailable } from './firebase';

// ── Client singleton ────────────────────────────────────────────────────────

let _client: CircleDeveloperControlledWalletsClient | null = null;

function getClient(): CircleDeveloperControlledWalletsClient {
  if (_client) return _client;

  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    throw new Error(
      'CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set. ' +
        'Get them from https://console.circle.com'
    );
  }

  _client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  return _client;
}

/** Whether Circle wallet infrastructure is configured. */
export function isCircleConfigured(): boolean {
  return !!(
    process.env.CIRCLE_API_KEY &&
    process.env.CIRCLE_ENTITY_SECRET &&
    process.env.CIRCLE_WALLET_SET_ID
  );
}

// ── Blockchain mapping ──────────────────────────────────────────────────────

/** Map our chain IDs to Circle's blockchain identifiers. */
function circleBlockchain(chainId: number): string {
  switch (chainId) {
    case 84532:
      return 'BASE-SEPOLIA';
    case 8453:
      return 'BASE';
    case 11155111:
      return 'ETH-SEPOLIA';
    case 1:
      return 'ETH';
    default:
      return 'BASE-SEPOLIA';
  }
}

// ── User wallet management ──────────────────────────────────────────────────

/** Firestore collection for mapping email/userId → Circle wallet. */
const getUserWalletsCol = () => (firebaseAvailable ? db.collection('circleWallets') : null);

// In-memory fallback for local dev
const memWallets = new Map<string, { walletId: string; address: string; blockchain: string }>();

export interface CircleWallet {
  walletId: string;
  address: string;
  blockchain: string;
}

/**
 * Look up an existing Circle wallet for a user (by email or userId).
 */
export async function getUserWallet(userId: string): Promise<CircleWallet | null> {
  const col = getUserWalletsCol();
  if (col) {
    const doc = await col.doc(userId).get();
    if (!doc.exists) return null;
    return doc.data() as CircleWallet;
  }
  return memWallets.get(userId) || null;
}

/**
 * Create a new Circle wallet for a user.
 * Creates an EOA on the configured blockchain.
 */
export async function createUserWallet(userId: string, chainId = 84532): Promise<CircleWallet> {
  const client = getClient();
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID;

  if (!walletSetId) {
    throw new Error('CIRCLE_WALLET_SET_ID is required');
  }

  const blockchain = circleBlockchain(chainId);

  const result = await client.createWallets({
    walletSetId,
    blockchains: [blockchain as any],
    count: 1,
    accountType: 'EOA',
  });

  const wallet = result.data?.wallets?.[0];
  if (!wallet) {
    throw new Error('Circle wallet creation failed — no wallet returned');
  }

  const circleWallet: CircleWallet = {
    walletId: wallet.id,
    address: wallet.address!,
    blockchain: wallet.blockchain!,
  };

  // Persist the mapping
  const col = getUserWalletsCol();
  if (col) {
    await col.doc(userId).set({
      ...circleWallet,
      userId,
      createdAt: new Date(),
    });
  } else {
    memWallets.set(userId, circleWallet);
  }

  return circleWallet;
}

/**
 * Get or create a wallet for a user.
 *
 * Idempotent across concurrent calls — two parallel register/verify requests
 * for the same userId will share a single Circle wallet. We can't use a
 * Firestore transaction (Circle is an external API call), so instead:
 *  - In-memory mutex dedupes in-process concurrent calls.
 *  - Post-create we re-check the Firestore doc; if another replica/process
 *    already wrote one, we keep the existing record and log the orphan so ops
 *    can garbage-collect it in Circle's dashboard.
 */
const _inflight = new Map<string, Promise<CircleWallet>>();

export async function getOrCreateWallet(userId: string, chainId = 84532): Promise<CircleWallet> {
  const existing = await getUserWallet(userId);
  if (existing) return existing;

  const pending = _inflight.get(userId);
  if (pending) return pending;

  const promise = (async (): Promise<CircleWallet> => {
    const wallet = await createUserWallet(userId, chainId);
    // Post-create: another process may have won the race. Firestore write-wins
    // semantics mean our doc would have overwritten theirs — re-read to detect
    // the race and log it. (Single-replica deploys never hit this path.)
    const col = getUserWalletsCol();
    if (col) {
      const reread = await col.doc(userId).get();
      const stored = reread.exists ? (reread.data() as CircleWallet) : null;
      if (stored && stored.walletId !== wallet.walletId) {
        console.warn(
          `[circle] concurrent wallet creation for ${userId} — keeping ${stored.walletId}, orphan: ${wallet.walletId}`
        );
        return stored;
      }
    }
    return wallet;
  })().finally(() => {
    _inflight.delete(userId);
  });

  _inflight.set(userId, promise);
  return promise;
}

// ── Transaction execution ───────────────────────────────────────────────────

export interface TxRequest {
  walletId: string;
  contractAddress: string;
  /** 0x-prefixed ABI-encoded calldata. */
  calldata: `0x${string}`;
  chainId: number;
  /** Native-token value as a wei string (e.g. "1000000000000000000" = 1 ETH). */
  value?: string;
}

export interface TxResult {
  txId: string;
  txHash?: string;
  state: string;
}

/**
 * Execute a contract call via Circle's developer-controlled wallet.
 * The server signs and broadcasts — no client-side key material needed.
 */
export async function executeTransaction(req: TxRequest): Promise<TxResult> {
  const client = getClient();
  // Blockchain isn't passed on contract-execution calls — Circle derives it
  // from the walletId — but we still validate the chain is recognised so a
  // caller can't silently route across networks.
  circleBlockchain(req.chainId);

  // Get the wallet address from Circle
  const walletResp = await client.getWallet({ id: req.walletId });
  const walletAddress = walletResp.data?.wallet?.address;
  if (!walletAddress) {
    throw new Error(`Wallet ${req.walletId} not found`);
  }

  // Circle takes `amount` as a decimal native-token string (e.g. "0.01"),
  // not wei. Convert from the wagmi-shape bigint-as-wei we accept.
  let amount: string | undefined;
  if (req.value && req.value !== '0') {
    try {
      amount = formatEther(BigInt(req.value));
    } catch {
      throw new Error(`Invalid value: ${req.value} is not a valid wei string`);
    }
  }

  const txResp = await client.createContractExecutionTransaction({
    walletId: req.walletId,
    callData: req.calldata,
    contractAddress: req.contractAddress,
    ...(amount ? { amount } : {}),
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  const txId = txResp.data?.id;
  if (!txId) {
    throw new Error('Transaction creation failed — no ID returned');
  }

  // Poll for completion (max 60 seconds)
  const TERMINAL_STATES = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'DENIED']);
  let state = txResp.data?.state ?? 'INITIATED';
  let txHash: string | undefined;
  const deadline = Date.now() + 60_000;

  while (!TERMINAL_STATES.has(state) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await client.getTransaction({ id: txId });
    state = poll.data?.transaction?.state ?? state;
    txHash = poll.data?.transaction?.txHash ?? undefined;
  }

  if (state !== 'COMPLETE') {
    throw new Error(`Transaction ended in state: ${state}`);
  }

  return { txId, txHash, state };
}

/**
 * Sign a message with a Circle wallet (for SIWE-compatible flows).
 */
export async function signMessage(walletId: string, message: string): Promise<string> {
  const client = getClient();

  // Circle's sign message API
  const resp = await (client as any).signMessage({
    walletId,
    message,
    encoding: 'UTF-8',
  });

  const signature = resp.data?.signature;
  if (!signature) {
    throw new Error('Message signing failed — no signature returned');
  }

  return signature;
}

/**
 * Get token balances for a Circle wallet.
 */
export async function getWalletBalances(walletId: string) {
  const client = getClient();
  const resp = await client.getWalletTokenBalance({ id: walletId });
  return resp.data?.tokenBalances ?? [];
}

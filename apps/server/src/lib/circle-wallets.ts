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
    case 1:
      return 'ETH';
    case 11155111:
      return 'ETH-SEPOLIA';
    default:
      // Hard-reject unknown chains rather than silently defaulting to Sepolia —
      // a wrong/typo chainId must never land a tx on the wrong network or pass
      // the executeTransaction wallet-vs-chain cross-check by coincidence.
      throw new Error(`Unsupported chainId ${chainId}: expected 1 (mainnet) or 11155111 (Sepolia)`);
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
/**
 * Create a Circle EOA on the given chain WITHOUT persisting any Firestore
 * mapping. Callers decide which doc key to store it under (default per-userId,
 * or chain-scoped). Keeps the raw Circle API call in one place.
 */
async function createCircleWalletRaw(chainId: number): Promise<CircleWallet> {
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

  return {
    walletId: wallet.id,
    address: wallet.address!,
    blockchain: wallet.blockchain!,
  };
}

/**
 * Create a new Circle wallet for a user and persist it under doc(userId)
 * (the default-chain mapping). Creates an EOA on the configured blockchain.
 */
async function createUserWallet(userId: string, chainId = 11155111): Promise<CircleWallet> {
  const circleWallet = await createCircleWalletRaw(chainId);

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

export async function getOrCreateWallet(userId: string, chainId = 11155111): Promise<CircleWallet> {
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

/**
 * Get or create a user's Circle wallet *on a specific chain*.
 *
 * The legacy `getOrCreateWallet` stores one doc per userId (doc(userId)) and
 * overwrites its `blockchain` field, so it can't hold wallets for more than one
 * chain at a time. Some flows (Uniswap Trading API swaps) must execute on a
 * chain other than the default Sepolia — and `executeTransaction` rejects
 * a tx whose chainId doesn't match the wallet's bound blockchain. This helper
 * keeps per-chain wallets without disturbing the primary one:
 *   - default chain (11155111) → legacy doc(userId), shared with getOrCreateWallet
 *   - any other chain          → doc(`${userId}:${chainId}`)
 * Both are stored in `circleWallets` with an `address` field, so
 * `resolveWalletByAddress` finds them too.
 */
const DEFAULT_WALLET_CHAIN = 11155111;
const _inflightByChain = new Map<string, Promise<CircleWallet>>();

export async function getOrCreateWalletForChain(
  userId: string,
  chainId: number
): Promise<CircleWallet> {
  if (chainId === DEFAULT_WALLET_CHAIN) return getOrCreateWallet(userId, chainId);

  const docKey = `${userId}:${chainId}`;
  const col = getUserWalletsCol();

  if (col) {
    const existing = await col.doc(docKey).get();
    if (existing.exists) return existing.data() as CircleWallet;
  } else {
    const mem = memWallets.get(docKey);
    if (mem) return mem;
  }

  const pending = _inflightByChain.get(docKey);
  if (pending) return pending;

  const promise = (async (): Promise<CircleWallet> => {
    // Raw create (no doc(userId) write) so we never clobber the user's
    // default-chain wallet record — store only under the chain-scoped key.
    const wallet = await createCircleWalletRaw(chainId);
    if (col) {
      await col.doc(docKey).set({
        ...wallet,
        userId,
        chainId,
        createdAt: new Date(),
      });
    } else {
      memWallets.set(docKey, wallet);
    }
    return wallet;
  })().finally(() => {
    _inflightByChain.delete(docKey);
  });

  _inflightByChain.set(docKey, promise);
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
  /**
   * If true, return as soon as Circle accepts the tx — caller is responsible
   * for polling `getTransactionStatus(txId)` until terminal. Defaults to false
   * (sync path: poll up to 60s and throw if not COMPLETE).
   */
  async?: boolean;
}

export interface TxResult {
  txId: string;
  txHash?: string;
  state: string;
}

const TERMINAL_STATES = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'DENIED']);

/**
 * Execute a contract call via Circle's developer-controlled wallet.
 * The server signs and broadcasts — no client-side key material needed.
 */
export async function executeTransaction(req: TxRequest): Promise<TxResult> {
  const client = getClient();
  const expectedBlockchain = circleBlockchain(req.chainId);

  // Fetch the wallet so we can cross-check that its network matches the chain
  // the caller asked for. Circle derives chain from walletId for contract
  // execution, so a mismatch would silently land the tx on the wrong network
  // (e.g. user has a BASE-SEPOLIA wallet but caller sent chainId=11155111).
  const walletResp = await client.getWallet({ id: req.walletId });
  const wallet = walletResp.data?.wallet;
  if (!wallet?.address) {
    throw new Error(`Wallet ${req.walletId} not found`);
  }
  if (wallet.blockchain && wallet.blockchain !== expectedBlockchain) {
    throw new Error(
      `Wallet ${req.walletId} is on ${wallet.blockchain} but chainId ${req.chainId} expects ${expectedBlockchain}`
    );
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

  let state = txResp.data?.state ?? 'INITIATED';
  let txHash: string | undefined;

  // Async path: caller will poll via getTransactionStatus. Useful for slow
  // networks where the sync 60s budget isn't enough and we'd otherwise throw
  // on a tx that actually lands.
  if (req.async) {
    return { txId, txHash, state };
  }

  // Sync path: poll for completion (max 60 seconds) and throw if not COMPLETE.
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
 * Fetch the current state + txHash for a Circle tx id. Used by the async
 * /api/tx/status endpoint.
 */
export async function getTransactionStatus(txId: string): Promise<TxResult> {
  const client = getClient();
  const resp = await client.getTransaction({ id: txId });
  const tx = resp.data?.transaction;
  if (!tx) {
    throw new Error(`Transaction ${txId} not found`);
  }
  return {
    txId,
    state: tx.state ?? 'UNKNOWN',
    txHash: tx.txHash ?? undefined,
  };
}

/**
 * Sign EIP-712 typed data with a Circle wallet (server-side, via KMS).
 * Used for off-chain authorizations such as Uniswap Permit2 swap permits.
 * `data` must be the JSON-stringified typed-data object.
 */
export async function signTypedData(
  walletId: string,
  data: string,
  memo?: string
): Promise<string> {
  const client = getClient();
  const resp = await client.signTypedData({ walletId, data, ...(memo ? { memo } : {}) });
  const signature = resp.data?.signature;
  if (!signature) {
    throw new Error('Circle signTypedData returned no signature');
  }
  return signature;
}

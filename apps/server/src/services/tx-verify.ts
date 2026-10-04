/**
 * Transaction Verification Service
 *
 * Shared utility for verifying on-chain transaction receipts.
 * Used by licensing, merch, and any router that accepts a txHash
 * from clients and needs to confirm it's real and successful.
 *
 * Pattern borrowed from credits.routes.ts verifyEthPayment().
 */
import { createPublicClient, http, type Hash } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { db } from '../lib/firebase';

// ── Chain clients ──────────────────────────────────────────────────────
const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
});

const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.RPC_URL_MAINNET ?? ''),
});

const ALLOWED_CHAIN_IDS: Set<number> = new Set([sepolia.id, mainnet.id]);

function getChainClient(chainId?: number) {
  if (chainId !== undefined && !ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new Error(`Chain ID ${chainId} is not supported.`);
  }
  if (chainId === mainnet.id) return mainnetClient;
  return sepoliaClient;
}

// ── RPC response cache (prevents DoS via repeated verification calls) ──
const TX_CACHE_TTL = 5 * 60 * 1000;
const TX_CACHE_MAX = 500;
const txCache = new Map<string, { data: any; ts: number }>();

function getCachedOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = txCache.get(key);
  if (cached && Date.now() - cached.ts < TX_CACHE_TTL) return cached.data as Promise<T>;
  const promise = fetcher();
  promise
    .then((data) => {
      if (txCache.size >= TX_CACHE_MAX) {
        const oldest = txCache.keys().next().value;
        if (oldest) txCache.delete(oldest);
      }
      txCache.set(key, { data, ts: Date.now() });
    })
    .catch((err) => {
      console.error(`[txCache] Fetch failed for ${key}:`, err?.message || err);
    });
  return promise;
}

// ── Collection for txHash deduplication ────────────────────────────────
const usedTxCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('usedTransactionHashes');
};

/** Dedup doc id — chain-scoped so the same hash on two chains is distinct, but
 *  one hash on a given chain can only ever be claimed once across ALL flows. */
function txClaimDocId(chainId: number | undefined, normalizedHash: string): string {
  return `${chainId ?? sepolia.id}:${normalizedHash}`;
}

/**
 * Atomically claim a txHash so it can never be redeemed twice — the single
 * cross-flow dedup authority. credits, entitlements, treasury, and NFT /
 * listing / split purchases ALL claim here, so one on-chain payment to the
 * platform treasury can't be cashed in for multiple products (PAY-01).
 *
 * Throws if the hash was already claimed for a DIFFERENT purpose or by a
 * different user (the cross-product / cross-user replay the audit flagged).
 * A same-user + same-purpose repeat is treated as an idempotent re-submit and
 * returns silently, so legit client double-submits (page refresh, double-tap)
 * don't error.
 *
 * Does NOT verify the tx on-chain — pair with verifyTxReceipt / verifyAndClaimTx
 * (which call this) or call after your own receipt verification.
 */
export async function claimTxHash(params: {
  txHash: string;
  purpose: string;
  callerUid: string;
  chainId?: number;
}): Promise<void> {
  if (!params.txHash || !params.txHash.startsWith('0x') || params.txHash.length !== 66) {
    throw new Error('Invalid transaction hash format');
  }
  const normalizedHash = params.txHash.toLowerCase();
  const ref = usedTxCol().doc(txClaimDocId(params.chainId, normalizedHash));
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (snap.exists) {
      const data = snap.data()!;
      // Idempotent: the original payer re-submitting for the SAME purpose is OK.
      // Anything else (different product/purpose or different user) is replay.
      if (data.callerUid === params.callerUid && data.purpose === params.purpose) return;
      throw new Error(
        `Transaction ${params.txHash} has already been used for "${data.purpose}". Each transaction can only be claimed once.`
      );
    }
    t.set(ref, {
      purpose: params.purpose,
      callerUid: params.callerUid,
      chainId: params.chainId ?? sepolia.id,
      claimedAt: new Date(),
    });
  });
}

/**
 * Default minimum block confirmations required before a value-bearing tx can be
 * claimed. Closes the reorg gap (audit M3): a freshly-mined (0–1 conf) receipt
 * can still be reorged out, so we wait a few blocks before crediting. This is
 * the shared default for verifyAndClaimTx (nft / listings / splits). The bespoke
 * credits/treasury flows use a higher MIN_CONFIRMATIONS = 6 in their own files.
 */
const VERIFY_TX_MIN_CONFIRMATIONS = 3;

export interface VerifyTxBinding {
  /** Require `tx.from` to equal this address (lowercase-compared). */
  expectedFrom?: string;
  /** Require `tx.to` to equal this address (lowercase-compared). */
  expectedTo?: string;
  /** Require `tx.value >= minValueWei` (string wei). */
  minValueWei?: string;
  /** Chain ID (defaults to Sepolia). */
  chainId?: number;
  /**
   * Minimum block confirmations before this tx may be claimed. Defaults to
   * VERIFY_TX_MIN_CONFIRMATIONS (3). Set to 0 to disable (non-value paths only).
   */
  minConfirmations?: number;
  /**
   * Extra receipt/tx check run after the from/to/value bindings and BEFORE the
   * hash is claimed (so a rejected tx isn't burned). Throw to reject.
   */
  assertReceipt?: (receipt: any, tx: any) => void;
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const ZERO_TOPIC = '0x' + '0'.repeat(64);

function topicToAddress(topic: string | undefined): string {
  return topic ? ('0x' + topic.slice(-40)).toLowerCase() : '';
}

/**
 * True when the receipt contains an NFT mint (ERC-721 `Transfer` or ERC-1155
 * `TransferSingle` from the zero address) to `to`, optionally emitted by
 * `contract` and for `tokenId`. Binds a "record my purchase" call to an actual
 * mint instead of any successful tx from the caller (audit R4-5).
 */
export function receiptHasMintTo(
  receipt: any,
  to: string,
  opts: { contract?: string; tokenId?: bigint | number } = {}
): boolean {
  const want = to.toLowerCase();
  const contract = opts.contract?.toLowerCase();
  const tokenId = opts.tokenId === undefined ? undefined : BigInt(opts.tokenId);
  for (const log of (receipt?.logs ?? []) as Array<{
    address?: string;
    topics?: string[];
    data?: string;
  }>) {
    if (contract && (log.address ?? '').toLowerCase() !== contract) continue;
    const t = log.topics ?? [];
    if (t[0] === TRANSFER_TOPIC && t.length === 4) {
      if (t[1] !== ZERO_TOPIC || topicToAddress(t[2]) !== want) continue;
      if (tokenId !== undefined && BigInt(t[3]) !== tokenId) continue;
      return true;
    }
    if (t[0] === TRANSFER_SINGLE_TOPIC && t.length === 4) {
      if (t[2] !== ZERO_TOPIC || topicToAddress(t[3]) !== want) continue;
      if (tokenId !== undefined) {
        const data = (log.data ?? '0x').slice(2);
        if (data.length < 64 || BigInt('0x' + data.slice(0, 64)) !== tokenId) continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Verify that a transaction hash corresponds to a real, successful on-chain tx
 * whose `from`, `to`, and `value` match the expected binding. Without these
 * bindings a caller can reuse any successful tx as "payment proof"; callers
 * MUST pass expectedFrom (and expectedTo/minValueWei where the purpose is a
 * value transfer) to prevent tx replay.
 *
 * Checks:
 * 1. txHash has not been claimed by another operation (deduplication)
 * 2. Transaction exists on-chain and was not reverted
 * 3. tx.from / tx.to / tx.value match the binding (when provided)
 *
 * On success, marks the txHash as used to prevent replay.
 */
export async function verifyAndClaimTx(
  txHash: string,
  purpose: string,
  callerUid: string,
  bindingOrChainId?: VerifyTxBinding | number
): Promise<{ receipt: any; tx: any }> {
  if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) {
    throw new Error('Invalid transaction hash format');
  }

  const binding: VerifyTxBinding =
    typeof bindingOrChainId === 'number' ? { chainId: bindingOrChainId } : (bindingOrChainId ?? {});
  const chainId = binding.chainId;

  const normalizedHash = txHash.toLowerCase();

  // 1. Deduplication — cheap pre-check (the authoritative atomic claim is step 4)
  const existingDoc = await usedTxCol().doc(txClaimDocId(chainId, normalizedHash)).get();
  if (existingDoc.exists) {
    const data = existingDoc.data()!;
    throw new Error(
      `Transaction ${txHash} has already been used for "${data.purpose}". Each transaction can only be claimed once.`
    );
  }

  // 2. On-chain verification — tx must exist and succeed
  const client = getChainClient(chainId);
  const chainName = chainId === 1 ? 'Ethereum' : 'Sepolia';

  let receipt: any;
  let tx: any;
  try {
    [receipt, tx] = await Promise.all([
      getCachedOrFetch<any>(
        `receipt-${normalizedHash}`,
        () => client.getTransactionReceipt({ hash: normalizedHash as Hash }) as Promise<any>
      ),
      getCachedOrFetch<any>(
        `tx-${normalizedHash}`,
        () => client.getTransaction({ hash: normalizedHash as Hash }) as Promise<any>
      ),
    ]);
  } catch {
    throw new Error(
      `Transaction not found on ${chainName}. Confirm it has been broadcast and included in a block.`
    );
  }

  if (receipt.status !== 'success') {
    throw new Error('Transaction was reverted on-chain.');
  }

  // 2b. Confirmation guard (audit M3) — a tx that has just been mined can still
  // be reorged out, so refuse to claim until it has enough confirmations.
  // Per M3 this is a HARD gate on the value path: if the block-number lookup
  // itself fails (RPC hiccup) we throw rather than silently proceeding, because
  // proceeding would credit a tx whose finality we couldn't establish.
  const minConfirmations = binding.minConfirmations ?? VERIFY_TX_MIN_CONFIRMATIONS;
  if (minConfirmations > 0) {
    // A receipt without a usable blockNumber can't be confirmation-checked;
    // treat that as not-yet-final (retryable) rather than assuming finality.
    if (receipt.blockNumber === undefined || receipt.blockNumber === null) {
      throw new Error(
        `Transaction has no block number yet; need ≥ ${minConfirmations} confirmation(s). Retry shortly.`
      );
    }
    let latestBlock: bigint;
    try {
      latestBlock = await client.getBlockNumber();
    } catch {
      throw new Error(
        'Could not confirm transaction finality (RPC error reading latest block). Retry shortly.'
      );
    }
    const confirmations = latestBlock - BigInt(receipt.blockNumber);
    if (confirmations < BigInt(minConfirmations)) {
      throw new Error(
        `Transaction has only ${confirmations} confirmation(s); need ≥ ${minConfirmations}. Retry shortly.`
      );
    }
  }

  // 3. Binding checks — reject if the tx doesn't match the expected principals.
  if (binding.expectedFrom) {
    const actualFrom = (tx?.from ?? '').toLowerCase();
    if (actualFrom !== binding.expectedFrom.toLowerCase()) {
      throw new Error('Transaction sender does not match the authenticated caller.');
    }
  }
  if (binding.expectedTo) {
    const actualTo = (tx?.to ?? '').toLowerCase();
    if (actualTo !== binding.expectedTo.toLowerCase()) {
      throw new Error('Transaction recipient does not match the expected payee.');
    }
  }
  if (binding.minValueWei) {
    const required = BigInt(binding.minValueWei);
    const actual = BigInt(tx?.value ?? 0);
    if (actual < required) {
      throw new Error('Transaction value is below the required amount.');
    }
  }

  if (binding.assertReceipt) binding.assertReceipt(receipt, tx);

  // 4. Atomically claim the txHash (cross-flow dedup authority).
  await claimTxHash({ txHash, purpose, callerUid, chainId });

  return { receipt, tx };
}

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
import { sepolia, baseSepolia } from 'viem/chains';
import { db } from '../lib/firebase';

// ── Chain clients ──────────────────────────────────────────────────────
const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
});

const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_BASE_SEPOLIA ?? ''),
});

const ALLOWED_CHAIN_IDS: Set<number> = new Set([sepolia.id, baseSepolia.id]);

function getChainClient(chainId?: number) {
  if (chainId !== undefined && !ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new Error(`Chain ID ${chainId} is not supported.`);
  }
  if (chainId === baseSepolia.id) return baseSepoliaClient;
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

export interface VerifyTxBinding {
  /** Require `tx.from` to equal this address (lowercase-compared). */
  expectedFrom?: string;
  /** Require `tx.to` to equal this address (lowercase-compared). */
  expectedTo?: string;
  /** Require `tx.value >= minValueWei` (string wei). */
  minValueWei?: string;
  /** Chain ID (defaults to Sepolia). */
  chainId?: number;
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

  // 1. Deduplication — check if this txHash was already used
  const existingDoc = await usedTxCol().doc(normalizedHash).get();
  if (existingDoc.exists) {
    const data = existingDoc.data()!;
    throw new Error(
      `Transaction ${txHash} has already been used for "${data.purpose}". Each transaction can only be claimed once.`
    );
  }

  // 2. On-chain verification — tx must exist and succeed
  const client = getChainClient(chainId);
  const chainName = chainId === baseSepolia.id ? 'Base Sepolia' : 'Sepolia';

  let receipt: any;
  let tx: any;
  try {
    [receipt, tx] = await Promise.all([
      getCachedOrFetch(`receipt-${normalizedHash}`, () =>
        client.getTransactionReceipt({ hash: normalizedHash as Hash })
      ),
      getCachedOrFetch(`tx-${normalizedHash}`, () =>
        client.getTransaction({ hash: normalizedHash as Hash })
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

  // 4. Mark txHash as claimed (atomic write)
  await usedTxCol()
    .doc(normalizedHash)
    .set({
      purpose,
      callerUid,
      chainId: chainId ?? sepolia.id,
      claimedAt: new Date(),
    });

  return { receipt, tx };
}

/**
 * Lightweight verification — checks tx exists and succeeded but does NOT
 * claim it for dedup. Use for optional/informational txHash fields.
 */
export async function verifyTxReceipt(txHash: string, chainId?: number): Promise<{ receipt: any }> {
  if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) {
    throw new Error('Invalid transaction hash format');
  }

  const client = getChainClient(chainId);
  const chainName = chainId === baseSepolia.id ? 'Base Sepolia' : 'Sepolia';

  let receipt: any;
  try {
    receipt = await getCachedOrFetch(`receipt-${txHash.toLowerCase()}`, () =>
      client.getTransactionReceipt({ hash: txHash.toLowerCase() as Hash })
    );
  } catch {
    throw new Error(
      `Transaction not found on ${chainName}. Confirm it has been broadcast and included in a block.`
    );
  }

  if (receipt.status !== 'success') {
    throw new Error('Transaction was reverted on-chain.');
  }

  return { receipt };
}

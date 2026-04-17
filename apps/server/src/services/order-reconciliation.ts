/**
 * Order Reconciliation Service — INFRA-01
 *
 * Solves the "paid but unrecorded" problem: if an on-chain ETH/LOAR transfer
 * succeeds but the subsequent Firestore write fails (network blip, timeout,
 * server crash), the user has paid but received no credits.
 *
 * This service:
 *  1. Scans `creditPurchases` for orders stuck in 'pending' or 'confirming'
 *  2. Verifies each order's txHash on-chain via viem
 *  3. If the tx succeeded, atomically grants credits (idempotent via dedup doc)
 *  4. If the tx failed/reverted, marks the order as 'failed'
 *
 * All writes are idempotent — safe to call repeatedly without double-crediting.
 */

import { db } from '../lib/firebase';
import { createPublicClient, http, type Hash } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';

// ── Chain clients ────────────────────────────────────────────────────

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
});

const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_BASE_SEPOLIA ?? ''),
});

function getChainClient(chainId: number) {
  if (chainId === baseSepolia.id) return baseSepoliaClient;
  if (chainId === sepolia.id) return sepoliaClient;
  throw new Error(`Unsupported chain ID: ${chainId}`);
}

function getChainName(chainId: number): string {
  if (chainId === baseSepolia.id) return 'Base Sepolia';
  return 'Sepolia';
}

// ── Collection helpers ───────────────────────────────────────────────

const purchasesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('creditPurchases');
};

const creditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};

const creditTxCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('creditTransactions');
};

// ── Types ────────────────────────────────────────────────────────────

interface ReconcileResult {
  txHash: string;
  orderId: string;
  previousStatus: string;
  newStatus: 'completed' | 'failed' | 'skipped';
  creditsGranted: number;
  error?: string;
}

interface PurchaseOrder {
  id: string;
  uid: string;
  txHash: string;
  chainId: number;
  status: string;
  packageId: string;
  credits: number;
  bonusCredits: number;
  paymentMethod: string;
  pricePaidUsd?: number;
  loarTokensPaid?: string;
  createdAt: FirebaseFirestore.Timestamp | Date;
}

// ── On-chain verification ────────────────────────────────────────────

async function verifyTxOnChain(
  txHash: string,
  chainId: number
): Promise<{ status: 'success' | 'reverted' | 'not_found' }> {
  const client = getChainClient(chainId);
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash as Hash });
    return { status: receipt.status === 'success' ? 'success' : 'reverted' };
  } catch (err: any) {
    // Transaction not found — could still be pending in mempool
    if (
      err?.message?.includes('could not be found') ||
      err?.message?.includes('not found') ||
      err?.name === 'TransactionNotFoundError'
    ) {
      return { status: 'not_found' };
    }
    throw err;
  }
}

// ── Single order reconciliation ──────────────────────────────────────

/**
 * Reconcile a single order by its txHash and chainId.
 * Idempotent: safe to call multiple times for the same tx.
 */
export async function reconcileSingleOrder(
  txHash: string,
  chainId: number
): Promise<ReconcileResult> {
  if (!db) throw new Error('Firebase is not configured');

  // Find the purchase order by txHash
  const snapshot = await purchasesCol()
    .where('txHash', '==', txHash)
    .where('chainId', '==', chainId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return {
      txHash,
      orderId: '',
      previousStatus: 'unknown',
      newStatus: 'skipped',
      creditsGranted: 0,
      error: 'No purchase order found for this txHash',
    };
  }

  const doc = snapshot.docs[0];
  const order = { id: doc.id, ...doc.data() } as PurchaseOrder;

  // Already finalized — nothing to do
  if (order.status === 'completed' || order.status === 'failed') {
    return {
      txHash,
      orderId: order.id,
      previousStatus: order.status,
      newStatus: 'skipped',
      creditsGranted: 0,
    };
  }

  // Verify on-chain
  const chainResult = await verifyTxOnChain(txHash, chainId);

  if (chainResult.status === 'not_found') {
    console.log(
      `[reconcile] tx ${txHash} not found on ${getChainName(chainId)} — skipping (may still be pending)`
    );
    return {
      txHash,
      orderId: order.id,
      previousStatus: order.status,
      newStatus: 'skipped',
      creditsGranted: 0,
      error: `Transaction not yet found on ${getChainName(chainId)}`,
    };
  }

  if (chainResult.status === 'reverted') {
    // Tx failed on-chain — mark order as failed
    await purchasesCol().doc(order.id).update({
      status: 'failed',
      reconciledAt: new Date(),
      reconcileNote: 'Transaction reverted on-chain',
    });

    console.log(`[reconcile] tx ${txHash} reverted on-chain — marked order ${order.id} as failed`);
    return {
      txHash,
      orderId: order.id,
      previousStatus: order.status,
      newStatus: 'failed',
      creditsGranted: 0,
    };
  }

  // Tx succeeded on-chain — grant credits atomically
  const totalCredits = (order.credits || 0) + (order.bonusCredits || 0);
  const dedupKey = `reconcile-${txHash}-${chainId}`;

  try {
    await db.runTransaction(async (tx) => {
      // Check dedup doc — prevents double-crediting
      const dedupRef = creditTxCol().doc(dedupKey);
      const dedupDoc = await tx.get(dedupRef);
      if (dedupDoc.exists) {
        // Credits already granted for this tx — just update the purchase status
        const purchaseRef = purchasesCol().doc(order.id);
        tx.update(purchaseRef, {
          status: 'completed',
          reconciledAt: new Date(),
          reconcileNote: 'Dedup doc already existed — status updated only',
        });
        return;
      }

      // Also check if the normal purchase flow already created a dedup doc
      // (fiat-<txHash> or loar-<txHash>-<chainId>)
      const fiatDedupRef = creditTxCol().doc(`fiat-${txHash}`);
      const loarDedupRef = creditTxCol().doc(`loar-${txHash}-${chainId}`);
      const [fiatDedupDoc, loarDedupDoc] = await Promise.all([
        tx.get(fiatDedupRef),
        tx.get(loarDedupRef),
      ]);

      if (fiatDedupDoc.exists || loarDedupDoc.exists) {
        // Normal flow already credited — just fix the purchase status
        const purchaseRef = purchasesCol().doc(order.id);
        tx.update(purchaseRef, {
          status: 'completed',
          reconciledAt: new Date(),
          reconcileNote: 'Original dedup doc found — status-only fix',
        });
        return;
      }

      // Grant credits to user
      const userRef = creditsCol().doc(order.uid);
      const userDoc = await tx.get(userRef);
      const prev = userDoc.data() ?? {};
      const now = new Date();

      const isLoar = order.paymentMethod === 'loar';

      tx.set(
        userRef,
        {
          uid: order.uid,
          balance: (prev.balance || 0) + totalCredits,
          totalPurchased: (prev.totalPurchased || 0) + (order.credits || 0),
          totalBonusReceived: (prev.totalBonusReceived || 0) + (order.bonusCredits || 0),
          totalLoarPurchases: (prev.totalLoarPurchases || 0) + (isLoar ? 1 : 0),
          totalFiatPurchases: (prev.totalFiatPurchases || 0) + (isLoar ? 0 : 1),
          totalSpent: prev.totalSpent || 0,
          updatedAt: now,
          ...(!userDoc.exists && { createdAt: now }),
        },
        { merge: true }
      );

      // Write dedup record
      tx.set(dedupRef, {
        id: dedupKey,
        uid: order.uid,
        type: 'purchase',
        paymentMethod: order.paymentMethod,
        packageId: order.packageId,
        credits: order.credits || 0,
        bonusCredits: order.bonusCredits || 0,
        totalCredits,
        pricePaidUsd: order.pricePaidUsd ?? null,
        loarTokensPaid: order.loarTokensPaid ?? null,
        txHash,
        chainId,
        reconciledAt: now,
        reconcileNote: 'Granted via order reconciliation (INFRA-01)',
        createdAt: now,
      });

      // Update the purchase order status
      const purchaseRef = purchasesCol().doc(order.id);
      tx.update(purchaseRef, {
        status: 'completed',
        reconciledAt: now,
        reconcileNote: 'Credits granted via reconciliation',
      });
    });

    console.log(
      `[reconcile] tx ${txHash} confirmed on-chain — granted ${totalCredits} credits to ${order.uid}`
    );
    return {
      txHash,
      orderId: order.id,
      previousStatus: order.status,
      newStatus: 'completed',
      creditsGranted: totalCredits,
    };
  } catch (err: any) {
    console.error(`[reconcile] Failed to reconcile tx ${txHash}:`, err?.message || err);
    return {
      txHash,
      orderId: order.id,
      previousStatus: order.status,
      newStatus: 'skipped',
      creditsGranted: 0,
      error: err?.message || 'Unknown error during reconciliation',
    };
  }
}

// ── Batch reconciliation ─────────────────────────────────────────────

/**
 * Scan all pending/confirming orders and reconcile them.
 * Designed to be called periodically (e.g. every 5 minutes via cron).
 */
export async function reconcileOrders(): Promise<{
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
  errors: string[];
  results: ReconcileResult[];
}> {
  if (!db) throw new Error('Firebase is not configured');

  console.log('[reconcile] Starting order reconciliation sweep...');

  // Query for unresolved orders
  const pendingSnapshot = await purchasesCol()
    .where('status', 'in', ['pending', 'confirming'])
    .get();

  if (pendingSnapshot.empty) {
    console.log('[reconcile] No pending orders to reconcile.');
    return { processed: 0, completed: 0, failed: 0, skipped: 0, errors: [], results: [] };
  }

  console.log(`[reconcile] Found ${pendingSnapshot.size} pending/confirming orders`);

  const results: ReconcileResult[] = [];
  const errors: string[] = [];
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const doc of pendingSnapshot.docs) {
    const data = doc.data();
    const txHash = data.txHash as string | undefined;
    const chainId = data.chainId as number | undefined;

    if (!txHash) {
      // No txHash means the user hasn't submitted a transaction yet
      skipped++;
      continue;
    }

    // Default to sepolia if chainId not recorded
    const resolvedChainId = chainId ?? sepolia.id;

    try {
      const result = await reconcileSingleOrder(txHash, resolvedChainId);
      results.push(result);

      switch (result.newStatus) {
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'skipped':
          skipped++;
          if (result.error) errors.push(`${txHash}: ${result.error}`);
          break;
      }
    } catch (err: any) {
      const msg = `${txHash}: ${err?.message || 'Unknown error'}`;
      errors.push(msg);
      skipped++;
      console.error(`[reconcile] Error processing order ${doc.id}:`, err?.message || err);
    }
  }

  console.log(
    `[reconcile] Sweep complete: ${pendingSnapshot.size} processed, ${completed} completed, ${failed} failed, ${skipped} skipped`
  );

  return {
    processed: pendingSnapshot.size,
    completed,
    failed,
    skipped,
    errors,
    results,
  };
}

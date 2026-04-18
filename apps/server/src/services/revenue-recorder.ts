/**
 * Revenue Recorder — Shared service for automatic revenue event recording.
 *
 * Called by marketplace, licensing, subscription, NFT, and ad routers
 * after successful transactions to feed the revenue dashboard.
 * Eliminates the manual `recordRevenue` admin-only gap.
 */
import { db } from '../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

const REVENUE_SOURCES = [
  'nft_sales',
  'subscriptions',
  'credits',
  'licensing',
  'merch',
  'ads',
  'canon_royalties',
  'collabs',
  'appearance_fees',
] as const;

export type RevenueSource = (typeof REVENUE_SOURCES)[number];

interface RevenueEvent {
  creatorUid: string;
  creatorAddress?: string | null;
  source: RevenueSource;
  amountWei: string;
  universeId?: string | null;
  metadata?: Record<string, string>;
}

/**
 * Record a revenue event into the revenueSnapshots collection.
 * This is the internal version — no auth check needed, called server-side
 * from other routers after successful transactions.
 *
 * Safe to call fire-and-forget (.catch(() => {})) from hot paths.
 */
export async function recordRevenueEvent(event: RevenueEvent): Promise<void> {
  if (!db) return;

  const date = new Date().toISOString().split('T')[0];
  const docId = `${event.creatorUid}_${date}_${event.source}`;

  // Convert wei to ETH for dashboard display
  const amountEth = Number(BigInt(event.amountWei)) / 1e18;

  await db
    .collection('revenueSnapshots')
    .doc(docId)
    .set(
      {
        creatorUid: event.creatorUid,
        creatorAddress: event.creatorAddress?.toLowerCase() ?? null,
        universeId: event.universeId ?? null,
        date,
        source: event.source,
        amountEth: FieldValue.increment(amountEth),
        amountWei: FieldValue.increment(Number(event.amountWei)),
        count: FieldValue.increment(1),
        updatedAt: new Date(),
      },
      { merge: true }
    );
}

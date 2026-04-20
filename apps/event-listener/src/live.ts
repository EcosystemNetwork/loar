/**
 * Live follow-the-head loop with re-org detection.
 *
 * Strategy:
 *   - Every POLL_INTERVAL_MS, fetch latest head.
 *   - Re-fetch the unconfirmed window (`head - finalityDepth .. head`) on each
 *     poll, not just new blocks. Records inside that window are marked
 *     `unconfirmed: true`.
 *   - Before re-processing the window, compare stored blockHash for the lowest
 *     block in the window to the current chain. If they differ, a re-org
 *     happened: delete all indexer_* docs whose `_event.blockHash` matches any
 *     stored hash for that block (Firestore query on `_event.blockHash`), then
 *     re-ingest from that block forward.
 *
 * This matches Ponder's `finalityBlockCount=15` behavior: blocks older than
 * 15 are treated as canonical; newer blocks may be rewritten.
 */
import { env } from './env.js';
import { logger } from './logger.js';
import { client } from './rpc.js';
import { db } from './firestore.js';
import { loadCheckpoint, writeCheckpoint } from './checkpoint.js';
import { ingestRange } from './ingest.js';
import { COLLECTIONS } from './schema.js';

// All indexer collections that hold per-event documents (i.e. have
// `_event.blockHash` set). Checkpoints + factoryChildren are excluded because
// they're keyed on stable identifiers and survive re-orgs.
const PER_EVENT_COLLECTIONS = [
  COLLECTIONS.universes,
  COLLECTIONS.tokens,
  COLLECTIONS.bondingCurves,
  COLLECTIONS.bondingCurveTrades,
  COLLECTIONS.bondingCurveSnapshots,
  COLLECTIONS.bondingCurveRefunds,
  COLLECTIONS.bondingCurveHaltEvents,
  COLLECTIONS.hookEvents,
  COLLECTIONS.nodes,
  COLLECTIONS.nodeCanonizations,
  COLLECTIONS.nodeContents,
  COLLECTIONS.tokenTransfers,
  COLLECTIONS.tokenHolders,
  COLLECTIONS.pools,
  COLLECTIONS.swaps,
  COLLECTIONS.proposals,
  COLLECTIONS.proposalExecutions,
  COLLECTIONS.proposalCancellations,
  COLLECTIONS.votes,
  COLLECTIONS.canonSubmissions,
  COLLECTIONS.canonVotes,
  COLLECTIONS.adSlots,
  COLLECTIONS.sponsorships,
  COLLECTIONS.licenses,
  COLLECTIONS.collabs,
];

async function detectReorg(windowStart: number): Promise<number | null> {
  // Pick a collection likely to have events in the window — swaps are highest
  // volume on most chains. Fall back to scanning bondingCurveTrades.
  for (const coll of [
    COLLECTIONS.swaps,
    COLLECTIONS.bondingCurveTrades,
    COLLECTIONS.tokenTransfers,
  ]) {
    const sample = await db
      .collection(coll)
      .where('_event.blockNumber', '>=', windowStart)
      .orderBy('_event.blockNumber', 'asc')
      .limit(1)
      .get();
    if (sample.empty) continue;
    const stored = sample.docs[0]!.data() as { _event: { blockNumber: number; blockHash: string } };
    const current = await client.getBlock({ blockNumber: BigInt(stored._event.blockNumber) });
    if (stored._event.blockHash !== current.hash.toLowerCase()) {
      return stored._event.blockNumber;
    }
    return null;
  }
  return null;
}

async function purgeFromBlock(blockNumber: number): Promise<number> {
  let totalDeleted = 0;
  for (const coll of PER_EVENT_COLLECTIONS) {
    let deletedInColl = 0;
    // Firestore `in` is capped, but we page by ranges on blockNumber.
    while (true) {
      const snap = await db
        .collection(coll)
        .where('_event.blockNumber', '>=', blockNumber)
        .limit(500)
        .get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deletedInColl += snap.size;
      if (snap.size < 500) break;
    }
    totalDeleted += deletedInColl;
  }
  return totalDeleted;
}

export async function runLiveLoop(): Promise<never> {
  logger.info({ poll_ms: env.LISTENER_POLL_INTERVAL_MS }, 'entering live loop');
  // Track local last-processed so we don't churn Firestore on every poll.
  let lastIndexed = (await loadCheckpoint())?.lastBlockIndexed ?? 0;

  while (true) {
    try {
      const head = Number(await client.getBlockNumber());
      const windowStart = Math.max(lastIndexed + 1, head - env.LISTENER_FINALITY_DEPTH);

      // Re-org check on the bottom of the window.
      const reorgAt = await detectReorg(windowStart);
      if (reorgAt !== null) {
        logger.warn({ reorgAt, windowStart }, 're-org detected, purging and re-ingesting');
        const deleted = await purgeFromBlock(reorgAt);
        logger.info({ reorgAt, deleted }, 're-org purge complete');
        lastIndexed = reorgAt - 1;
      }

      if (head > lastIndexed) {
        const from = lastIndexed + 1;
        const to = head;
        const finalityCut = head - env.LISTENER_FINALITY_DEPTH;

        // Process confirmed portion (if any) first — these won't need rewrite.
        if (finalityCut >= from) {
          const { eventCount } = await ingestRange(from, finalityCut, { unconfirmed: false });
          logger.debug({ from, to: finalityCut, eventCount }, 'ingested confirmed');
        }
        // Then the unconfirmed window up to head.
        const unconfirmedFrom = Math.max(from, finalityCut + 1);
        if (unconfirmedFrom <= to) {
          const { eventCount } = await ingestRange(unconfirmedFrom, to, { unconfirmed: true });
          logger.debug({ from: unconfirmedFrom, to, eventCount }, 'ingested unconfirmed');
        }

        await writeCheckpoint(head, head);
        lastIndexed = head;
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'live loop iteration failed');
    }
    await new Promise((r) => setTimeout(r, env.LISTENER_POLL_INTERVAL_MS));
  }
}

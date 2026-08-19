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
import { client, chainId } from './rpc.js';
import { db } from './firestore.js';
import { loadCheckpoint, writeCheckpoint } from './checkpoint.js';
import { ingestRange } from './ingest.js';
import { chainConfig } from './chain-config.js';
import { clearFactoryCache } from './factory.js';
import { COLLECTIONS } from './schema.js';

const CHAIN = env.LISTENER_CHAIN;

export function planLiveRanges(
  lastIndexed: number,
  head: number,
  startBlock: number,
  finalityDepth: number
) {
  const finalityCut = Math.max(startBlock - 1, head - finalityDepth);
  const windowStart = Math.max(startBlock, finalityCut);
  return {
    finalityCut,
    windowStart,
    confirmedCatchup:
      lastIndexed + 1 < windowStart ? { from: lastIndexed + 1, to: windowStart - 1 } : null,
    confirmedBoundary: windowStart <= finalityCut ? { from: windowStart, to: finalityCut } : null,
    unconfirmed:
      Math.max(startBlock, finalityCut + 1) <= head
        ? { from: Math.max(startBlock, finalityCut + 1), to: head }
        : null,
  };
}

// All indexer collections that carry an event envelope. A detected re-org
// clears the affected chain projection and rebuilds it from the deployment
// start block so mutable aggregates cannot retain orphaned event effects.
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
  COLLECTIONS.episodeCanonizations,
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
  COLLECTIONS.bounties,
  COLLECTIONS.eventReceipts,
  COLLECTIONS.aggregateEventClaims,
];

async function detectReorg(windowStart: number): Promise<number | null> {
  // Pick a collection likely to have events in the window — swaps are highest
  // volume on most chains. Fall back to bondingCurveTrades / tokenTransfers.
  // MUST filter by chainId: both event-listener services (sepolia + base-sepolia)
  // write to the same Firestore collections, so a cross-chain sample would look
  // up a foreign block number on the wrong RPC and throw "Block not found" —
  // or, worse, false-positive a reorg and purge valid same-block data from the
  // sibling chain.
  for (const coll of [
    COLLECTIONS.eventReceipts,
    COLLECTIONS.aggregateEventClaims,
    COLLECTIONS.swaps,
    COLLECTIONS.bondingCurveTrades,
    COLLECTIONS.tokenTransfers,
  ]) {
    const sample = await db
      .collection(coll)
      .where('_event.chainId', '==', chainId)
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

async function purgeChainState(): Promise<number> {
  let totalDeleted = 0;
  for (const coll of PER_EVENT_COLLECTIONS) {
    while (true) {
      const snap = await db
        .collection(coll)
        .where('_event.chainId', '==', chainId)
        .limit(500)
        .get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      totalDeleted += snap.size;
      if (snap.size < 500) break;
    }
  }

  while (true) {
    const snap = await db
      .collection(COLLECTIONS.factoryChildren)
      .where('chain', '==', CHAIN)
      .limit(500)
      .get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    totalDeleted += snap.size;
    if (snap.size < 500) break;
  }

  while (true) {
    const snap = await db
      .collection('episodes')
      .where('indexerChainId', '==', chainId)
      .limit(500)
      .get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    totalDeleted += snap.size;
    if (snap.size < 500) break;
  }

  clearFactoryCache();
  return totalDeleted;
}

export async function runLiveLoop(onIndexed?: (block: number) => void): Promise<never> {
  logger.info({ poll_ms: env.LISTENER_POLL_INTERVAL_MS }, 'entering live loop');
  // Track local last-processed so we don't churn Firestore on every poll.
  let lastIndexed = (await loadCheckpoint())?.lastBlockIndexed ?? 0;

  while (true) {
    try {
      const head = Number(await client.getBlockNumber());
      const { finalityCut, windowStart, confirmedCatchup, confirmedBoundary, unconfirmed } =
        planLiveRanges(lastIndexed, head, chainConfig.startBlock, env.LISTENER_FINALITY_DEPTH);

      // Re-org check on the bottom of the window.
      const reorgAt = await detectReorg(windowStart);
      if (reorgAt !== null) {
        logger.warn({ reorgAt, windowStart }, 're-org detected, purging and re-ingesting');
        const deleted = await purgeChainState();
        logger.info({ reorgAt, deleted }, 're-org purge complete');
        lastIndexed = chainConfig.startBlock - 1;
      }

      const step = env.LISTENER_BLOCK_RANGE;

      // If the service was offline and the gap exceeds one RPC chunk, we
      // must iterate — a single eth_getLogs over N blocks fails when N > the
      // provider's per-call cap. Free-tier Alchemy caps at 10; PAYG at 2000+.
      // Chunk size matches the backfill knob so live & backfill behave
      // identically on catch-up.
      if (confirmedCatchup) {
        for (let cur = confirmedCatchup.from; cur <= confirmedCatchup.to; cur += step) {
          const end = Math.min(cur + step - 1, confirmedCatchup.to);
          const { eventCount } = await ingestRange(cur, end, { unconfirmed: false });
          logger.debug({ from: cur, to: end, eventCount }, 'ingested confirmed chunk');
        }
      }

      // Process confirmed portion (if any) first — these won't need rewrite.
      if (confirmedBoundary) {
        const { eventCount } = await ingestRange(confirmedBoundary.from, confirmedBoundary.to, {
          unconfirmed: false,
        });
        logger.debug(
          { from: confirmedBoundary.from, to: confirmedBoundary.to, eventCount },
          'ingested finality boundary'
        );
      }

      // Then the unconfirmed window up to head.
      if (unconfirmed) {
        for (let cur = unconfirmed.from; cur <= unconfirmed.to; cur += step) {
          const end = Math.min(cur + step - 1, unconfirmed.to);
          const { eventCount } = await ingestRange(cur, end, { unconfirmed: true });
          logger.debug({ from: cur, to: end, eventCount }, 'ingested unconfirmed chunk');
        }
      }

      await writeCheckpoint(head, head);
      lastIndexed = head;
      onIndexed?.(head);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'live loop iteration failed');
    }
    await new Promise((r) => setTimeout(r, env.LISTENER_POLL_INTERVAL_MS));
  }
}

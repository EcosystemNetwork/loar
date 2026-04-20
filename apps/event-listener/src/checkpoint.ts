/**
 * Per-chain checkpoint store in Firestore (`indexer_checkpoints/{chain}`).
 *
 * - `lastBlockIndexed`: highest block we've finished writing logs for.
 * - `lastBlockFinalized`: lastBlockIndexed minus finalityDepth; anything at or
 *   below this is considered canonical and read without the unconfirmed filter.
 * - `headBlockKnown`: the most recent head we observed (for diagnostics).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firestore.js';
import { chainId } from './rpc.js';
import { env } from './env.js';
import { COLLECTIONS, type IndexerCheckpoint } from './schema.js';

const CHAIN = env.LISTENER_CHAIN;

export async function loadCheckpoint(): Promise<IndexerCheckpoint | null> {
  const doc = await db.collection(COLLECTIONS.checkpoints).doc(CHAIN).get();
  if (!doc.exists) return null;
  return doc.data() as IndexerCheckpoint;
}

export async function writeCheckpoint(
  lastBlockIndexed: number,
  headBlockKnown: number
): Promise<void> {
  const lastBlockFinalized = Math.max(0, lastBlockIndexed - env.LISTENER_FINALITY_DEPTH);
  const data: IndexerCheckpoint = {
    chain: CHAIN,
    chainId,
    lastBlockIndexed,
    lastBlockFinalized,
    headBlockKnown,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.collection(COLLECTIONS.checkpoints).doc(CHAIN).set(data, { merge: true });
}

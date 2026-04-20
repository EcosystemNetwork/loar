/**
 * Firestore batch-write helper.
 *
 * Firestore commits cap at 500 ops per batch. This wrapper accepts any number
 * of staged writes and flushes them in 500-op chunks. Reads inside the same
 * logical handler should use transactions (via `runTransaction`) instead; this
 * is purely for append-only inserts and unconditional sets.
 *
 * All docs go through `buildEnvelope()` which stamps the EventEnvelope used by
 * the re-org handler for blockHash-keyed rollback.
 */
import { FieldValue, WriteBatch, type DocumentReference } from 'firebase-admin/firestore';
import { db } from './firestore.js';
import { logger } from './logger.js';
import { chainId } from './rpc.js';
import type { EventEnvelope, Hex } from './schema.js';

const MAX_BATCH_OPS = 500;

type Op =
  | { kind: 'set'; ref: DocumentReference; data: FirebaseFirestore.DocumentData; merge?: boolean }
  | { kind: 'update'; ref: DocumentReference; data: FirebaseFirestore.DocumentData }
  | { kind: 'delete'; ref: DocumentReference };

export class Batcher {
  private ops: Op[] = [];

  set(ref: DocumentReference, data: FirebaseFirestore.DocumentData, merge = false): this {
    this.ops.push({ kind: 'set', ref, data, merge });
    return this;
  }

  update(ref: DocumentReference, data: FirebaseFirestore.DocumentData): this {
    this.ops.push({ kind: 'update', ref, data });
    return this;
  }

  delete(ref: DocumentReference): this {
    this.ops.push({ kind: 'delete', ref });
    return this;
  }

  size(): number {
    return this.ops.length;
  }

  async commit(): Promise<void> {
    let pending = this.ops;
    this.ops = [];
    while (pending.length) {
      const chunk = pending.slice(0, MAX_BATCH_OPS);
      pending = pending.slice(MAX_BATCH_OPS);
      const batch: WriteBatch = db.batch();
      for (const op of chunk) {
        if (op.kind === 'set') batch.set(op.ref, op.data, { merge: op.merge ?? false });
        else if (op.kind === 'update') batch.update(op.ref, op.data);
        else batch.delete(op.ref);
      }
      try {
        await batch.commit();
      } catch (err) {
        logger.error({ err: (err as Error).message, ops: chunk.length }, 'batch commit failed');
        throw err;
      }
    }
  }
}

export function buildEnvelope(args: {
  blockNumber: number;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
  unconfirmed: boolean;
}): EventEnvelope {
  return {
    chainId,
    blockNumber: args.blockNumber,
    blockHash: args.blockHash.toLowerCase() as Hex,
    txHash: args.txHash.toLowerCase() as Hex,
    logIndex: args.logIndex,
    unconfirmed: args.unconfirmed,
    indexedAt: FieldValue.serverTimestamp(),
  };
}

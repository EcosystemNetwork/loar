/**
 * Cancelling a generation.
 *
 * A generation lives in two places: its `videoGenerations` Firestore record and
 * (when Redis is configured) a BullMQ job that carries the admission-time
 * spend hold. Cancelling has to settle both, and has to stay correct when it
 * races the worker:
 *
 *  - The record flips to `cancelled` in a transaction, so a job that has
 *    already finished (or failed) can never be relabelled after the fact.
 *  - A job that hasn't started is removed from the queue and its spend hold
 *    released immediately.
 *  - A job that is already running can't be aborted (the provider call is in
 *    flight and billed). It is left to finish, but the worker checks
 *    `isGenerationCancelled` before writing its result so it never overwrites
 *    the cancelled record.
 */
import type { Firestore } from 'firebase-admin/firestore';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export type CancelRecordOutcome =
  | { kind: 'not_found' }
  | { kind: 'not_owner' }
  | { kind: 'already_terminal'; status: string }
  | { kind: 'cancelled'; creditsCharged: number; creditsRefunded: boolean };

/** Atomically flips a non-terminal generation to `cancelled`. */
export async function cancelGenerationRecord(
  firestore: Firestore,
  input: { generationId: string; userId: string; reason?: string | null }
): Promise<CancelRecordOutcome> {
  const ref = firestore.collection('videoGenerations').doc(input.generationId);
  return firestore.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return { kind: 'not_found' } as const;
    const d = (doc.data() ?? {}) as Record<string, any>;
    if (d.userId !== input.userId) return { kind: 'not_owner' } as const;
    if (TERMINAL.has(d.status)) return { kind: 'already_terminal', status: d.status } as const;
    const now = new Date();
    tx.update(ref, {
      status: 'cancelled',
      cancelledAt: now,
      cancelReason: input.reason ?? null,
      completedAt: now,
    });
    return {
      kind: 'cancelled',
      creditsCharged: (d.creditsCharged ?? 0) as number,
      creditsRefunded: Boolean(d.creditsRefunded),
    } as const;
  });
}

/** True when the record has been cancelled — workers check this before writing a result. */
export async function isGenerationCancelled(
  firestore: Firestore,
  generationId: string
): Promise<boolean> {
  const doc = await firestore.collection('videoGenerations').doc(generationId).get();
  return doc.exists && doc.data()?.status === 'cancelled';
}

/** Queue states in which BullMQ can still remove a job without touching a running worker. */
const REMOVABLE_STATES = new Set(['waiting', 'delayed', 'prioritized', 'waiting-children']);

export type DequeueOutcome = 'removed' | 'running' | 'not_queued';

/**
 * Removes a not-yet-started job from the generation queue and releases the spend
 * hold it was carrying. A running job is reported as `running` and left alone.
 * Never throws — the record is already cancelled, and the hold expires on its own.
 */
export async function dequeueGenerationJob(generationId: string): Promise<DequeueOutcome> {
  try {
    const { getGenerationQueue } = await import('./queue');
    const job = await getGenerationQueue().getJob(generationId);
    if (!job) return 'not_queued';
    const state = await job.getState();
    if (!REMOVABLE_STATES.has(state)) return state === 'active' ? 'running' : 'not_queued';
    await job.remove();
    const { releaseJobSpendHold } = await import('./video-budget');
    await releaseJobSpendHold(job);
    return 'removed';
  } catch (err) {
    console.warn('[generation-cancel] dequeue failed:', (err as Error).message);
    return 'not_queued';
  }
}

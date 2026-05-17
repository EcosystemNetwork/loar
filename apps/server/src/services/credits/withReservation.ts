/**
 * `withReservation` — single canonical helper for the reserve/reconcile/cancel
 * lifecycle. Every generation router should call this instead of rolling its
 * own `deductCredits`/`refundCredits` pair.
 *
 * Usage:
 *
 *   return withReservation(
 *     {
 *       userId: ctx.user.uid,
 *       modelId: 'fal-flux-pro',
 *       provider: 'fal',
 *       estimatedCredits: cost,
 *       byok: false,
 *       meta: { generationId, episodeId },
 *     },
 *     async (reservationId) => {
 *       const result = await provider.generate(...);
 *       if (result.status === 'failed') throw new Error(result.error);
 *       // Optional: refine to actual cost. Defaults to estimatedCredits.
 *       return { result, actualCredits: cost };
 *     }
 *   );
 *
 * On success: reserves estimated × 1 buffer, runs fn, then reconciles to the
 * actual cost (refunds delta if estimate > actual, debits if estimate <
 * actual and bucket can cover, marks `overrun_blocked` otherwise).
 *
 * On thrown error: cancels the reservation (full refund), rethrows for the
 * caller to handle.
 *
 * The caller is responsible for the reservation buffer. Most generation
 * call sites have deterministic pricing (per-image / per-second-at-known-
 * duration) so `actualCredits === estimatedCredits` is the common case and
 * the buffer is effectively 1.0×. Variable-duration call sites (captions,
 * transcribe-then-bill-by-minute) should pass a 1.20× buffer in
 * `estimatedCredits`.
 */
import { reserve } from './reserve';
import { reconcile, cancel } from './reconcile';
import type { ReserveInput } from './types';

export interface ReservedWork<T> {
  result: T;
  /** Actual credits to bill. Defaults to `estimatedCredits` from the reserve. */
  actualCredits?: number;
}

export async function withReservation<T>(
  input: ReserveInput,
  fn: (reservationId: string) => Promise<ReservedWork<T>>
): Promise<T> {
  const { reservationId } = await reserve(input);
  try {
    const work = await fn(reservationId);
    await reconcile({
      reservationId,
      actualCredits: work.actualCredits ?? input.estimatedCredits,
    });
    return work.result;
  } catch (err) {
    await cancel(reservationId, err instanceof Error ? err.message : 'failed');
    throw err;
  }
}

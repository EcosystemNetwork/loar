/**
 * `reconcile()` / `cancel()` — retired.
 *
 * The paired half of `reserve()`. Credits/points are no longer a ledger, so
 * there is nothing to refund, debit, or mark blocked. Kept as no-ops so the
 * `withReservation` lifecycle and every existing call site keep compiling.
 */
import type { ReconcileInput, ReconcileResult } from './types';

export async function reconcile(_input: ReconcileInput): Promise<ReconcileResult> {
  return { status: 'reconciled', refunded: 0, charged: 0, balanceAfter: 0 };
}

export async function cancel(_reservationId: string, _reason: string): Promise<void> {
  // no-op
}

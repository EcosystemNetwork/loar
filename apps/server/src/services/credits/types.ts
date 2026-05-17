/**
 * Shared types for the reserve/reconcile credit primitives.
 *
 * Two-phase commit on the user's credit bucket:
 *
 *   reserve(...)   → debits an estimated amount, returns reservationId
 *   reconcile(...) → finalises with the actual amount; refunds overage,
 *                    debits underrun (within the 1.20 buffer headroom),
 *                    or marks the reservation `overrun_blocked` when the
 *                    user can no longer cover the true cost.
 *   cancel(...)    → full refund for failed jobs.
 *
 * Matches PRD `docs/prd-model-metering.md` §"Per-job flow".
 */

export type ReservationStatus = 'pending' | 'reconciled' | 'cancelled' | 'overrun_blocked';

export type BucketName = 'freeMonthly' | 'subscription' | 'topup';

export interface CreditReservation {
  id: string;
  userId: string;
  /** Optional context for analytics + admin debugging. */
  modelId: string;
  provider: string;
  /** Server pool key used vs. user-supplied BYOK key. */
  byok: boolean;
  /** Credits actually debited at reserve() time (estimate × 1.20 buffer). */
  reservedCredits: number;
  /** Credits truly owed once the job finished. null until reconciled. */
  actualCredits: number | null;
  /** Net delta refunded (+) or charged (-) by reconcile(). */
  reconciledDelta: number | null;
  status: ReservationStatus;
  /** Free-form metadata for audit (e.g. caption project id, episode id). */
  meta: Record<string, string | number | boolean | null>;
  createdAt: Date;
  reconciledAt: Date | null;
}

export interface ReserveInput {
  userId: string;
  modelId: string;
  provider: string;
  /** Credits the caller has already padded with the 1.20 buffer. */
  estimatedCredits: number;
  byok: boolean;
  meta?: Record<string, string | number | boolean | null>;
}

export interface ReserveResult {
  reservationId: string;
  /** Caller's balance after the debit, for UI display. */
  balanceAfter: number;
}

export interface ReconcileInput {
  reservationId: string;
  actualCredits: number;
}

export interface ReconcileResult {
  status: 'reconciled' | 'overrun_blocked' | 'already_reconciled';
  refunded: number; // 0 if no refund
  charged: number; // 0 if no overrun charge
  balanceAfter: number;
}

export class InsufficientCreditsError extends Error {
  constructor(
    public requested: number,
    public available: number
  ) {
    super(`Insufficient credits. Need ${requested}, have ${available}.`);
    this.name = 'InsufficientCreditsError';
  }
}

export class ReservationNotFoundError extends Error {
  constructor(public reservationId: string) {
    super(`Reservation not found: ${reservationId}`);
    this.name = 'ReservationNotFoundError';
  }
}

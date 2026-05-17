/**
 * `reconcile()` — phase 2 of the two-phase commit on a user's credit bucket.
 *
 * Given a `reservationId` and the actual credits truly owed, atomically:
 *   - refunds the delta when actual < reserved (the common case — the
 *     1.20 buffer is almost always over),
 *   - debits the additional delta when actual > reserved AND the user
 *     still has the balance to cover it,
 *   - or marks the reservation `overrun_blocked` when the user cannot
 *     cover the overrun. The service has already been delivered at this
 *     point, so the platform absorbs the unrecoverable delta and the
 *     audit row captures who/what for ops review.
 *
 * Idempotent: a reservation already in a terminal status returns
 * `already_reconciled` without touching the bucket.
 *
 * `cancel()` is the failure-path companion — full refund, status set to
 * `cancelled`. Used when the upstream provider call throws.
 */
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { db } from '../../lib/firebase';
import { logFailedRefund } from '../../lib/refund-audit';
import {
  ReservationNotFoundError,
  type ReconcileInput,
  type ReconcileResult,
  type CreditReservation,
} from './types';

function userCreditsRef(userId: string) {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits').doc(userId);
}

function reservationsRef(id: string) {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('creditReservations').doc(id);
}

function isTerminal(status: string): boolean {
  return status === 'reconciled' || status === 'cancelled' || status === 'overrun_blocked';
}

export async function reconcile(input: ReconcileInput): Promise<ReconcileResult> {
  if (!db) throw new Error('Firebase is not configured');
  if (input.actualCredits < 0) {
    throw new Error('reconcile() called with negative actualCredits');
  }
  const resRef = reservationsRef(input.reservationId);

  return db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(resRef);
    if (!snap.exists) throw new ReservationNotFoundError(input.reservationId);
    const res = snap.data() as CreditReservation;
    if (isTerminal(res.status)) {
      // Idempotent reconcile — return the balance without further changes.
      const credSnap = await tx.get(userCreditsRef(res.userId));
      return {
        status: 'already_reconciled' as const,
        refunded: 0,
        charged: 0,
        balanceAfter: (credSnap.data()?.balance as number) ?? 0,
      };
    }

    const reserved = res.reservedCredits;
    const actual = input.actualCredits;
    const delta = reserved - actual; // >0 = refund, <0 = overrun

    const credRef = userCreditsRef(res.userId);
    const credSnap = await tx.get(credRef);
    const balance = (credSnap.data()?.balance as number) ?? 0;
    const totalSpent = (credSnap.data()?.totalSpent as number) ?? 0;

    if (delta >= 0) {
      // Refund overage — actual was within reservation.
      const newBalance = balance + delta;
      tx.set(
        credRef,
        {
          balance: newBalance,
          totalSpent: totalSpent - delta,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      tx.update(resRef, {
        status: 'reconciled',
        actualCredits: actual,
        reconciledDelta: delta,
        reconciledAt: FieldValue.serverTimestamp(),
      });
      return {
        status: 'reconciled' as const,
        refunded: delta,
        charged: 0,
        balanceAfter: newBalance,
      };
    }

    // Overrun path: actual > reserved. Try to cover from balance.
    const overrun = -delta;
    if (balance >= overrun) {
      const newBalance = balance - overrun;
      tx.set(
        credRef,
        {
          balance: newBalance,
          totalSpent: totalSpent + overrun,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      tx.update(resRef, {
        status: 'reconciled',
        actualCredits: actual,
        reconciledDelta: -overrun,
        reconciledAt: FieldValue.serverTimestamp(),
      });
      return {
        status: 'reconciled' as const,
        refunded: 0,
        charged: overrun,
        balanceAfter: newBalance,
      };
    }

    // Can't cover the overrun. Mark blocked, leave balance alone, log for ops.
    tx.update(resRef, {
      status: 'overrun_blocked',
      actualCredits: actual,
      reconciledDelta: 0,
      reconciledAt: FieldValue.serverTimestamp(),
    });
    return {
      status: 'overrun_blocked' as const,
      refunded: 0,
      charged: 0,
      balanceAfter: balance,
    };
  });
}

/**
 * Failure-path companion to reconcile. Full refund + cancel the
 * reservation. Use when the provider call throws or returns failed.
 */
export async function cancel(reservationId: string, reason: string): Promise<void> {
  if (!db) throw new Error('Firebase is not configured');
  const resRef = reservationsRef(reservationId);
  try {
    await db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(resRef);
      if (!snap.exists) throw new ReservationNotFoundError(reservationId);
      const res = snap.data() as CreditReservation;
      if (isTerminal(res.status)) return; // idempotent

      const credRef = userCreditsRef(res.userId);
      const credSnap = await tx.get(credRef);
      const balance = (credSnap.data()?.balance as number) ?? 0;
      const totalSpent = (credSnap.data()?.totalSpent as number) ?? 0;
      tx.set(
        credRef,
        {
          balance: balance + res.reservedCredits,
          totalSpent: totalSpent - res.reservedCredits,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      tx.update(resRef, {
        status: 'cancelled',
        reconciledDelta: res.reservedCredits,
        reconciledAt: FieldValue.serverTimestamp(),
        meta: { ...res.meta, cancelReason: reason },
      });
    });
  } catch (err) {
    // Refund-on-cancel is best-effort. Same fail-safe pattern as the
    // ad-hoc refundCredits helpers — log to the audit collection and
    // continue, never re-throw a refund failure into the user's call.
    console.error(`CRITICAL: reservation cancel/refund failed for ${reservationId}:`, err);
    try {
      const snap = await resRef.get();
      const data = snap.exists ? (snap.data() as CreditReservation) : null;
      logFailedRefund({
        userId: data?.userId ?? 'unknown',
        credits: data?.reservedCredits ?? 0,
        source: 'reservation_cancel',
        generationId: reservationId,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    } catch {
      // ignore — we've already logged at console level
    }
  }
}

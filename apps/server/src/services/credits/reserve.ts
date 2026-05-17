/**
 * `reserve()` — phase 1 of the two-phase commit on a user's credit bucket.
 *
 * Runs the kill-switch + spend-cap guards, then atomically debits the
 * estimated credits from `userCredits/{userId}` and writes a pending
 * `creditReservations/{id}` doc. Returns the reservation id, which the
 * caller passes to `reconcile()` (success path) or `cancel()` (failure
 * path) once the job completes.
 *
 * Concurrency: Firestore transaction ensures only one reserve wins when
 * multiple requests race against the same bucket — loser receives
 * `InsufficientCreditsError`.
 */
import { randomUUID } from 'crypto';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { db } from '../../lib/firebase';
import { assertGenerationAllowed } from '../../lib/generation-guards';
import { InsufficientCreditsError, type ReserveInput, type ReserveResult } from './types';

function userCreditsRef(userId: string) {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits').doc(userId);
}

function reservationsRef(id: string) {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('creditReservations').doc(id);
}

export async function reserve(input: ReserveInput): Promise<ReserveResult> {
  if (!db) throw new Error('Firebase is not configured');
  if (input.estimatedCredits <= 0) {
    throw new Error('reserve() called with non-positive estimatedCredits');
  }

  // Kill-switch + monthly spend cap. Mirrors the existing pattern in the
  // ad-hoc `deductCredits` helpers across generation routers.
  await assertGenerationAllowed(input.userId, input.estimatedCredits);

  const reservationId = randomUUID();
  const creditsRef = userCreditsRef(input.userId);
  const resRef = reservationsRef(reservationId);

  const balanceAfter = await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(creditsRef);
    const balance = snap.exists ? ((snap.data()?.balance as number) ?? 0) : 0;
    if (balance < input.estimatedCredits) {
      throw new InsufficientCreditsError(input.estimatedCredits, balance);
    }
    const newBalance = balance - input.estimatedCredits;
    tx.set(
      creditsRef,
      {
        balance: newBalance,
        totalSpent: ((snap.data()?.totalSpent as number) ?? 0) + input.estimatedCredits,
        updatedAt: new Date(),
      },
      { merge: true }
    );
    tx.set(resRef, {
      id: reservationId,
      userId: input.userId,
      modelId: input.modelId,
      provider: input.provider,
      byok: input.byok,
      reservedCredits: input.estimatedCredits,
      actualCredits: null,
      reconciledDelta: null,
      status: 'pending',
      meta: input.meta ?? {},
      createdAt: FieldValue.serverTimestamp(),
      reconciledAt: null,
    });
    return newBalance;
  });

  return { reservationId, balanceAfter };
}

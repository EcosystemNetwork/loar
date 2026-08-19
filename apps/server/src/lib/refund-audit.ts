/**
 * Refund audit trail — logs failed credit refunds to Firestore for
 * operational recovery. When a refund fails (Firestore quota exceeded,
 * network partition, etc.), users lose credits silently. This audit
 * trail enables operators to detect and manually reconcile.
 *
 * Collection: `failedRefunds`
 */
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { db } from './firebase';

export interface GenerationFailureInput {
  userId: string;
  generationId: string;
  creditsCharged: number;
  failureReason: string;
  latencyMs: number;
}

export type GenerationFailureResult =
  | 'refunded'
  | 'already_refunded'
  | 'already_completed'
  | 'not_charged';

export async function finalizeGenerationFailure(
  firestore: Firestore,
  input: GenerationFailureInput
): Promise<GenerationFailureResult> {
  const generationRef = firestore.collection('videoGenerations').doc(input.generationId);
  const creditsRef = firestore.collection('userCredits').doc(input.userId);

  return firestore.runTransaction(async (tx: Transaction) => {
    const generationDoc = await tx.get(generationRef);
    if (!generationDoc.exists) throw new Error(`Generation ${input.generationId} not found`);

    const generation = generationDoc.data() ?? {};
    if (generation.creditsRefundedAt) return 'already_refunded';
    if (generation.status === 'completed') return 'already_completed';

    const completedAt = new Date();
    if (input.creditsCharged <= 0) {
      tx.update(generationRef, {
        status: 'failed',
        failureReason: input.failureReason,
        latencyMs: input.latencyMs,
        completedAt,
      });
      return 'not_charged';
    }

    const creditsDoc = await tx.get(creditsRef);
    if (!creditsDoc.exists) throw new Error(`Credit account ${input.userId} not found`);

    const credits = creditsDoc.data() ?? {};
    tx.update(creditsRef, {
      balance: Number(credits.balance ?? 0) + input.creditsCharged,
      totalSpent: Number(credits.totalSpent ?? 0) - input.creditsCharged,
      updatedAt: completedAt,
    });
    tx.update(generationRef, {
      status: 'failed',
      failureReason: input.failureReason,
      latencyMs: input.latencyMs,
      completedAt,
      creditsRefunded: input.creditsCharged,
      creditsRefundedAt: completedAt,
    });
    return 'refunded';
  });
}

export interface FailedRefundEntry {
  userId: string;
  credits: number;
  source: string;
  generationId: string;
  error: string;
  resolved?: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

/**
 * Log a failed refund to the `failedRefunds` Firestore collection.
 * Best-effort — if this fails too, we log to console as last resort.
 */
export async function logFailedRefund(entry: FailedRefundEntry): Promise<void> {
  try {
    if (!db) {
      console.error('CRITICAL: Cannot log failed refund — db not configured:', entry);
      return;
    }
    await db.collection('failedRefunds').add({
      ...entry,
      resolved: false,
      createdAt: new Date(),
    });
    console.error(
      `REFUND AUDIT: Logged failed refund of ${entry.credits} credits for user ${entry.userId} from ${entry.source}`
    );
  } catch (auditErr) {
    // Last resort — console is the only option
    console.error('CRITICAL: Failed to log refund audit entry:', entry, auditErr);
  }
}

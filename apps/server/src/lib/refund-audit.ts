/**
 * Refund audit trail — logs failed credit refunds to Firestore for
 * operational recovery. When a refund fails (Firestore quota exceeded,
 * network partition, etc.), users lose credits silently. This audit
 * trail enables operators to detect and manually reconcile.
 *
 * Collection: `failedRefunds`
 */
import { db } from './firebase';

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

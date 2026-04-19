/**
 * Job idempotency — prevents double-charge on agent retries.
 *
 * When a client (typically an MCP server) supplies a `clientToken` with
 * a mutation that creates a billable async job, we reserve a Firestore
 * doc at {ownerUid}:{clientToken}. If the same owner retries with the
 * same token within the TTL, the existing job reference is returned
 * instead of a new job being created.
 *
 * Storage: Firestore `jobIdempotency` collection, auto-expires after TTL.
 * Concurrency: Firestore transaction to avoid races between parallel retries.
 *
 * See docs/prd-mcp-integration.md §2.
 */
import { db, firebaseAvailable } from './firebase';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLIENT_TOKEN_MIN = 16;
const CLIENT_TOKEN_MAX = 128;
const CLIENT_TOKEN_RE = /^[A-Za-z0-9_-]+$/;

export interface IdempotencyRecord {
  ownerUid: string;
  clientToken: string;
  jobId: string;
  procedure: string; // e.g. "generation.generate"
  createdAt: Date;
  expiresAt: Date;
}

const idempotencyCol = () => {
  if (!firebaseAvailable || !db) return null;
  return db.collection('jobIdempotency');
};

function docIdFor(ownerUid: string, clientToken: string): string {
  // Firestore doc IDs can't contain /. Use a separator that the token regex
  // forbids so the join is unambiguous.
  return `${ownerUid}:${clientToken}`;
}

export function isValidClientToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    token.length >= CLIENT_TOKEN_MIN &&
    token.length <= CLIENT_TOKEN_MAX &&
    CLIENT_TOKEN_RE.test(token)
  );
}

/**
 * Reserve the idempotency slot. If a non-expired record already exists,
 * return it (caller should short-circuit and return the existing jobId).
 * Otherwise insert a new record with the caller-supplied jobId and return null.
 *
 * Safe under concurrent retries: uses a Firestore transaction so exactly
 * one concurrent caller wins.
 *
 * Returns:
 *   { existing: IdempotencyRecord }  → caller should return the existing jobId
 *   { existing: null }               → caller may proceed to create a new job
 *   null                             → firestore unavailable (fail-open; skip idempotency)
 */
export async function reserveClientToken(params: {
  ownerUid: string;
  clientToken: string;
  jobId: string;
  procedure: string;
}): Promise<{ existing: IdempotencyRecord | null } | null> {
  const col = idempotencyCol();
  if (!col) return null;

  const { ownerUid, clientToken, jobId, procedure } = params;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  const ref = col.doc(docIdFor(ownerUid, clientToken));

  return db!.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() as IdempotencyRecord;
      const existingExpiresAt =
        data.expiresAt instanceof Date ? data.expiresAt : new Date(data.expiresAt as any);
      if (existingExpiresAt.getTime() > now.getTime()) {
        return { existing: data };
      }
      // Expired — overwrite with the new reservation
    }
    const record: IdempotencyRecord = {
      ownerUid,
      clientToken,
      jobId,
      procedure,
      createdAt: now,
      expiresAt,
    };
    tx.set(ref, record);
    return { existing: null };
  });
}

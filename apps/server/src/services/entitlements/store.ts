/**
 * Firestore-backed store for account entitlements + BYOK unlock codes.
 *
 * Hot path: `isByokFeeWaived(uid)` is called inside `reserve()` for every
 * BYOK generation, so it goes through a short in-memory TTL cache. Writes
 * invalidate the cache.
 */
import { randomUUID } from 'crypto';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { db, firebaseAvailable } from '../../lib/firebase';
import {
  CodeAlreadyRedeemedError,
  EntitlementAlreadyActiveError,
  InvalidUnlockCodeError,
} from './types';
import type { BYOKUnlockCode, UnlockMethod, UserEntitlement } from './types';

const ENTITLEMENTS_COL = 'userEntitlements';
const CODES_COL = 'byokUnlockCodes';

function entitlementsRef(uid: string) {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection(ENTITLEMENTS_COL).doc(uid);
}

function codesRef(code: string) {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection(CODES_COL).doc(code);
}

// ── Hot-path cache ─────────────────────────────────────────────────────
const WAIVED_CACHE_TTL_MS = 60_000;
const waivedCache = new Map<string, { value: boolean; expiresAt: number }>();

function cacheGet(uid: string): boolean | null {
  const hit = waivedCache.get(uid);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    waivedCache.delete(uid);
    return null;
  }
  return hit.value;
}

function cacheSet(uid: string, value: boolean) {
  waivedCache.set(uid, { value, expiresAt: Date.now() + WAIVED_CACHE_TTL_MS });
}

function cacheInvalidate(uid: string) {
  waivedCache.delete(uid);
}

// ── Reads ──────────────────────────────────────────────────────────────

export async function getEntitlement(uid: string): Promise<UserEntitlement | null> {
  if (!firebaseAvailable) return null;
  const snap = await entitlementsRef(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() as Partial<UserEntitlement>;
  return {
    uid,
    byokFeeWaived: Boolean(data.byokFeeWaived),
    unlockedAt: (data.unlockedAt as any)?.toDate?.() ?? null,
    unlockedVia: (data.unlockedVia as UnlockMethod | null) ?? null,
    sourceRef: data.sourceRef ?? null,
    amountPaid: data.amountPaid ?? null,
    updatedAt: (data.updatedAt as any)?.toDate?.() ?? new Date(),
  };
}

/**
 * Hot-path check used by `reserve()`. Returns false if Firebase is offline
 * — never blocks generation on infra hiccups.
 */
export async function isByokFeeWaived(uid: string): Promise<boolean> {
  if (!uid) return false;
  if (!firebaseAvailable) return false;
  const cached = cacheGet(uid);
  if (cached !== null) return cached;
  try {
    const snap = await entitlementsRef(uid).get();
    const waived = snap.exists ? Boolean(snap.data()?.byokFeeWaived) : false;
    cacheSet(uid, waived);
    return waived;
  } catch (err) {
    console.warn('[entitlements] isByokFeeWaived lookup failed:', err);
    return false;
  }
}

// ── Writes ─────────────────────────────────────────────────────────────

/**
 * Idempotent grant — if the entitlement is already active, throws
 * `EntitlementAlreadyActiveError`. Caller should treat that as success
 * but skip the payment-side credit/refund step.
 */
export async function grantFeeWaiver(args: {
  uid: string;
  unlockedVia: UnlockMethod;
  sourceRef: string;
  amountPaid?: string;
  /** If supplied, runs inside the provided Firestore transaction. */
  tx?: Transaction;
}): Promise<void> {
  if (!firebaseAvailable) throw new Error('Firebase is not configured');
  const ref = entitlementsRef(args.uid);
  const payload = {
    uid: args.uid,
    byokFeeWaived: true,
    unlockedAt: FieldValue.serverTimestamp(),
    unlockedVia: args.unlockedVia,
    sourceRef: args.sourceRef,
    amountPaid: args.amountPaid ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (args.tx) {
    const snap = await args.tx.get(ref);
    if (snap.exists && snap.data()?.byokFeeWaived) {
      throw new EntitlementAlreadyActiveError(args.uid);
    }
    args.tx.set(ref, payload, { merge: true });
  } else {
    await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (snap.exists && snap.data()?.byokFeeWaived) {
        throw new EntitlementAlreadyActiveError(args.uid);
      }
      t.set(ref, payload, { merge: true });
    });
  }

  cacheInvalidate(args.uid);
}

// ── Codes ──────────────────────────────────────────────────────────────

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function mintCode(args: {
  code?: string;
  note?: string;
  maxRedemptions?: number;
  expiresAt?: Date | null;
  createdBy: string;
}): Promise<BYOKUnlockCode> {
  if (!firebaseAvailable) throw new Error('Firebase is not configured');
  const code = normalizeCode(args.code ?? randomUUID().replace(/-/g, '').slice(0, 12));
  if (!/^[A-Z0-9-]{4,40}$/.test(code)) {
    throw new InvalidUnlockCodeError(code, 'code must be 4–40 alphanumeric characters');
  }
  const ref = codesRef(code);
  const existing = await ref.get();
  if (existing.exists) {
    throw new InvalidUnlockCodeError(code, 'code already exists');
  }
  const doc: BYOKUnlockCode = {
    code,
    note: args.note ?? '',
    maxRedemptions: args.maxRedemptions ?? 1,
    redeemedBy: [],
    redeemedAt: [],
    expiresAt: args.expiresAt ?? null,
    createdBy: args.createdBy,
    createdAt: new Date(),
    active: true,
  };
  await ref.set(doc);
  return doc;
}

export async function listCodes(limit = 100): Promise<BYOKUnlockCode[]> {
  if (!firebaseAvailable) return [];
  const snap = await db.collection(CODES_COL).orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const data = d.data() as any;
    return {
      code: d.id,
      note: data.note ?? '',
      maxRedemptions: data.maxRedemptions ?? 1,
      redeemedBy: data.redeemedBy ?? [],
      redeemedAt: (data.redeemedAt ?? []).map((t: any) => t?.toDate?.() ?? new Date(t)),
      expiresAt: data.expiresAt?.toDate?.() ?? null,
      createdBy: data.createdBy ?? '',
      createdAt: data.createdAt?.toDate?.() ?? new Date(),
      active: data.active !== false,
    };
  });
}

export async function revokeCode(code: string): Promise<void> {
  if (!firebaseAvailable) throw new Error('Firebase is not configured');
  const ref = codesRef(normalizeCode(code));
  const snap = await ref.get();
  if (!snap.exists) throw new InvalidUnlockCodeError(code, 'not found');
  await ref.update({ active: false });
}

/**
 * Atomically:
 *   1. Validates the code (exists, active, not expired, not at cap, not
 *      already redeemed by this uid).
 *   2. Records the redemption in the code doc.
 *   3. Grants the fee waiver to the user.
 *
 * Idempotent for users who already have the waiver via another method —
 * those throw `EntitlementAlreadyActiveError` so the UI can surface it.
 */
export async function redeemCode(args: { uid: string; code: string }): Promise<{ code: string }> {
  if (!firebaseAvailable) throw new Error('Firebase is not configured');
  const code = normalizeCode(args.code);
  const codeRefDoc = codesRef(code);
  const userRefDoc = entitlementsRef(args.uid);

  await db.runTransaction(async (tx) => {
    const [codeSnap, userSnap] = await Promise.all([tx.get(codeRefDoc), tx.get(userRefDoc)]);
    if (!codeSnap.exists) throw new InvalidUnlockCodeError(code, 'not found');
    const codeData = codeSnap.data() as Partial<BYOKUnlockCode>;
    if (codeData.active === false) throw new InvalidUnlockCodeError(code, 'revoked');
    const expiresAt = (codeData.expiresAt as any)?.toDate?.() ?? null;
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      throw new InvalidUnlockCodeError(code, 'expired');
    }
    const redeemedBy: string[] = codeData.redeemedBy ?? [];
    if (redeemedBy.includes(args.uid)) {
      throw new CodeAlreadyRedeemedError(code);
    }
    const max = codeData.maxRedemptions ?? 1;
    if (redeemedBy.length >= max) {
      throw new InvalidUnlockCodeError(code, 'redemption limit reached');
    }
    if (userSnap.exists && userSnap.data()?.byokFeeWaived) {
      throw new EntitlementAlreadyActiveError(args.uid);
    }

    tx.update(codeRefDoc, {
      redeemedBy: FieldValue.arrayUnion(args.uid),
      redeemedAt: FieldValue.arrayUnion(new Date()),
    });
    tx.set(
      userRefDoc,
      {
        uid: args.uid,
        byokFeeWaived: true,
        unlockedAt: FieldValue.serverTimestamp(),
        unlockedVia: 'code' as UnlockMethod,
        sourceRef: code,
        amountPaid: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  cacheInvalidate(args.uid);
  return { code };
}

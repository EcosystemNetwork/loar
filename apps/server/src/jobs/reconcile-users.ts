/**
 * User-count reconciliation — keeps the `users` collection (which
 * `/admin/dashboard` counts by `firstLoginAt`) in sync with `userAccounts`
 * (the email / Google signup records written server-side by the auth handlers).
 *
 * The forward path is already covered in real time: `recordLogin`
 * (apps/server/src/lib/record-login.ts) runs inside `/auth/circle/verify-otp`
 * and `/auth/circle/social`. This sweep is the safety net — it backfills any
 * historical `userAccounts` that predate that fix, and self-heals drift if
 * `recordLogin` ever starts failing.
 *
 * Cheap by design: each tick does one aggregation count on each collection and
 * returns immediately when they match, so the steady state is ~2 reads / 6h.
 * Runs by default; set USER_RECONCILE_OFF=1 to disable. Single-replica safe —
 * the writes are idempotent `create`-if-absent per address.
 */
import { db, firebaseAvailable } from '../lib/firebase';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const SCAN_PAGE = 500;

let timer: NodeJS.Timeout | null = null;

interface ReconcileResult {
  scanned: number;
  created: number;
  skipped: number;
}

/**
 * Copy every `userAccounts` doc that has no matching `users/{walletAddress}`
 * doc into `users`, dating `firstLoginAt` from the account's `createdAt` so the
 * historical signup trend stays accurate. Does not grant signup credits.
 */
export async function reconcileUsersFromAccounts(): Promise<ReconcileResult> {
  const result: ReconcileResult = { scanned: 0, created: 0, skipped: 0 };
  if (!firebaseAvailable) return result;

  const [accountsCount, usersCount] = await Promise.all([
    db.collection('userAccounts').count().get(),
    db.collection('users').count().get(),
  ]);
  if (accountsCount.data().count <= usersCount.data().count) return result;

  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db.collection('userAccounts').orderBy('__name__').limit(SCAN_PAGE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;

    let batch = db.batch();
    let inBatch = 0;
    for (const doc of page.docs) {
      result.scanned++;
      const a = doc.data();
      const addr = String(a.walletAddress || '').toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr)) {
        result.skipped++;
        continue;
      }
      const userRef = db.collection('users').doc(addr);
      if ((await userRef.get()).exists) continue;

      const createdAt =
        (a.createdAt?.toDate?.() as Date | undefined) ??
        (a.createdAt instanceof Date ? a.createdAt : new Date());
      batch.set(
        userRef,
        {
          address: addr,
          firstLoginAt: createdAt,
          lastLoginAt: createdAt,
          loginCount: 1,
          chainId: 0,
          connector: a.provider || 'email',
          authProvider: a.provider || 'email',
          email: a.email || doc.id,
          signupCreditsGranted: 0,
          backfilledFrom: 'userAccounts',
          backfilledAt: new Date(),
        },
        { merge: true }
      );
      result.created++;
      inBatch++;
      if (inBatch >= 400) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) await batch.commit();

    last = page.docs[page.docs.length - 1];
    if (page.size < SCAN_PAGE) break;
  }

  return result;
}

export function startUserReconcileJob(): void {
  if (process.env.USER_RECONCILE_OFF === '1') return;
  if (timer) return;
  const raw = parseInt(process.env.USER_RECONCILE_INTERVAL_MS ?? '', 10);
  const interval = Number.isFinite(raw) && raw >= 60_000 ? raw : DEFAULT_INTERVAL_MS;

  const tick = async () => {
    try {
      const r = await reconcileUsersFromAccounts();
      if (r.created || r.skipped) {
        console.log(
          `[reconcile-users] scanned ${r.scanned}, backfilled ${r.created} into users/, skipped ${r.skipped} (bad walletAddress)`
        );
      }
    } catch (err) {
      console.error('[reconcile-users] sweep failed:', err);
    }
  };

  void tick();
  timer = setInterval(tick, interval);
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopUserReconcileJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

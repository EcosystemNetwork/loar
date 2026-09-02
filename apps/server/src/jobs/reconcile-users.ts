/**
 * User-count reconciliation — keeps the `users` collection (which
 * `/admin/dashboard` counts by `firstLoginAt`) in sync with the two upstream
 * signup records:
 *   • `userAccounts`  — email / Google signups (written by the auth handlers)
 *   • `walletLogins`  — every authenticated session (written by `recordLogin`)
 *
 * The forward path is already covered in real time: `recordLogin`
 * (apps/server/src/lib/record-login.ts) runs inside `/auth/circle/verify-otp`,
 * `/auth/circle/social`, and the client `trackWalletLogin` backstop. These
 * sweeps are the safety net — they backfill historical records that predate
 * that fix, and self-heal drift if the `users` write ever fails while the
 * upstream row still lands (the pre-fix single-transaction `recordLogin` did
 * exactly this whenever the signup credit grant threw).
 *
 * Cheap by design: the `userAccounts` sweep does one aggregation count on each
 * collection and returns immediately when they match (~2 reads / 6h steady
 * state). The `walletLogins` sweep reads a bounded, most-recent window.
 * Runs by default; set USER_RECONCILE_OFF=1 to disable both, or
 * USER_RECONCILE_WALLET_OFF=1 to disable just the `walletLogins` sweep.
 * Single-replica safe — the writes are idempotent `create`-if-absent per address.
 */
import { db, firebaseAvailable } from '../lib/firebase';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const SCAN_PAGE = 500;
/** Most-recent `walletLogins` rows scanned per sweep. */
const WALLET_SCAN_LIMIT = 20_000;
const EVM_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

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
  const nAccounts = accountsCount.data().count;
  const nUsers = usersCount.data().count;
  console.log(`[reconcile-users] users=${nUsers} userAccounts=${nAccounts}`);
  if (nAccounts <= nUsers) return result;

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

/**
 * Backfill `users/{address}` docs for wallet addresses that appear in
 * `walletLogins` but never got a `users` row — the signature of a
 * `recordLogin` where the audit row landed but the `users` write was rolled
 * back (historically, by a failing signup credit grant sharing its
 * transaction). `firstLoginAt` is dated from the earliest login seen in the
 * scanned window. Does not grant signup credits.
 *
 * Bounded: scans the most-recent `WALLET_SCAN_LIMIT` login rows. A user whose
 * logins are all older than that window and who still has no `users` doc is
 * beyond self-heal here — the forward path in `recordLogin` now prevents new
 * occurrences.
 */
export async function reconcileUsersFromWalletLogins(): Promise<ReconcileResult> {
  const result: ReconcileResult = { scanned: 0, created: 0, skipped: 0 };
  if (!firebaseAvailable) return result;
  if (process.env.USER_RECONCILE_WALLET_OFF === '1') return result;

  const snap = await db
    .collection('walletLogins')
    .orderBy('loginAt', 'desc')
    .limit(WALLET_SCAN_LIMIT)
    .get();

  // Earliest login timestamp per distinct address in the window.
  const earliest = new Map<string, Date>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const addr = String(data.address || '').toLowerCase();
    if (!EVM_ADDRESS_RE.test(addr)) {
      result.skipped++;
      continue;
    }
    const raw = data.loginAt;
    const date: Date =
      raw?.toDate?.() ?? (raw instanceof Date ? raw : raw ? new Date(raw) : new Date());
    const prev = earliest.get(addr);
    if (!prev || date < prev) earliest.set(addr, date);
  }

  let batch = db.batch();
  let inBatch = 0;
  for (const [addr, firstSeen] of earliest) {
    result.scanned++;
    const userRef = db.collection('users').doc(addr);
    if ((await userRef.get()).exists) continue;

    batch.set(
      userRef,
      {
        address: addr,
        firstLoginAt: firstSeen,
        lastLoginAt: firstSeen,
        loginCount: 1,
        chainId: 0,
        connector: 'unknown',
        authProvider: 'wallet',
        signupCreditsGranted: 0,
        backfilledFrom: 'walletLogins',
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

  return result;
}

export function startUserReconcileJob(): void {
  if (process.env.USER_RECONCILE_OFF === '1') return;
  if (timer) return;
  const raw = parseInt(process.env.USER_RECONCILE_INTERVAL_MS ?? '', 10);
  const interval = Number.isFinite(raw) && raw >= 60_000 ? raw : DEFAULT_INTERVAL_MS;

  const tick = async () => {
    try {
      const acct = await reconcileUsersFromAccounts();
      if (acct.created || acct.skipped) {
        console.log(
          `[reconcile-users] accounts: scanned ${acct.scanned}, backfilled ${acct.created} into users/, skipped ${acct.skipped} (bad walletAddress)`
        );
      }
    } catch (err) {
      console.error('[reconcile-users] accounts sweep failed:', err);
    }

    try {
      const wl = await reconcileUsersFromWalletLogins();
      if (wl.created || wl.skipped) {
        console.log(
          `[reconcile-users] walletLogins: scanned ${wl.scanned}, backfilled ${wl.created} into users/, skipped ${wl.skipped} (bad address)`
        );
      }
    } catch (err) {
      console.error('[reconcile-users] walletLogins sweep failed:', err);
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

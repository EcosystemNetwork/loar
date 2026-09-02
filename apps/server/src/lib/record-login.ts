/**
 * lib/record-login — the single source of truth for turning an authenticated
 * session into analytics rows (`users` + `walletLogins`) and the one-time
 * signup credit grant.
 *
 * This logic used to live only in the `trackWalletLogin` tRPC mutation, which
 * fires from the browser and whose failures are swallowed client-side
 * (`.catch(() => {})` in `useTrackWalletLogin`). Email / Google signups that
 * never produced a successful client round-trip therefore never landed in the
 * `users` collection, and `/admin/dashboard` — which derives "total users" and
 * "new users" from that collection by `firstLoginAt` — silently under-reported
 * growth. The server auth handlers (`/auth/circle/verify-otp`,
 * `/auth/circle/social`) now call `recordLogin` directly, so the dashboard no
 * longer depends on a best-effort client call.
 */
import { db, firebaseAvailable } from './firebase';
import { grantCreditsInTxn } from '../routers/credits/credits.routes';

/**
 * One-time signup bonus granted on first login.
 * 500 credits ≈ $5 of generation value at the retail Starter rate.
 *
 * Guarded against a malformed env value: a non-numeric `SIGNUP_CREDIT_GRANT`
 * would otherwise be `NaN`, and a `NaN` credit write throws inside the grant
 * transaction — which historically took the `users` doc down with it and
 * under-reported `/admin/dashboard` growth.
 */
const RAW_SIGNUP_CREDIT_GRANT = Number(process.env.SIGNUP_CREDIT_GRANT ?? 500);
export const SIGNUP_CREDIT_GRANT =
  Number.isFinite(RAW_SIGNUP_CREDIT_GRANT) && RAW_SIGNUP_CREDIT_GRANT >= 0
    ? RAW_SIGNUP_CREDIT_GRANT
    : 500;

export interface RecordLoginInput {
  /** Canonical EVM address (the JWT `sub`). Case-insensitive; stored lowercased. */
  address: string;
  chainId?: number;
  connector?: string;
  /** Present for email / Google sessions — persisted on the user doc for support. */
  email?: string;
  /** Auth provider label, e.g. 'email' | 'google' | wallet connector name. */
  provider?: string;
}

export interface RecordLoginResult {
  ok: true;
  newUser: boolean;
  creditsGranted: number;
}

/**
 * Append a `walletLogins` audit row and upsert the `users/{address}` doc,
 * then grant the one-time signup bonus on first login. Idempotent per address:
 * calling it on every login just bumps `lastLoginAt` / `loginCount`.
 *
 * The `users` upsert and the credit grant run in **separate** transactions on
 * purpose. The `users` doc is the source of truth for `/admin/dashboard`
 * counts and must never be rolled back by a credit-ledger failure — the
 * previous single-transaction version silently dropped a user from the totals
 * whenever `grantCreditsInTxn` threw (e.g. a `NaN` grant, ledger contention).
 * The grant is idempotent via the `signupCreditsGranted` flag, so two
 * concurrent first logins still can't double-grant.
 */
export async function recordLogin(input: RecordLoginInput): Promise<RecordLoginResult> {
  if (!firebaseAvailable) return { ok: true, newUser: false, creditsGranted: 0 };

  const now = new Date();
  const address = input.address.toLowerCase();
  const chainId = input.chainId ?? 0;
  const connector = input.connector || input.provider || 'unknown';

  await db.collection('walletLogins').add({
    address,
    chainId,
    connector,
    loginAt: now,
    userAgent: '',
  });

  // 1) Analytics row. No credit dependency — this must land for every session.
  const isNewUser = await db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(address);
    const userDoc = await tx.get(userRef);

    if (userDoc.exists) {
      tx.update(userRef, {
        lastLoginAt: now,
        loginCount: (userDoc.data()?.loginCount || 0) + 1,
        chainId,
        ...(input.email ? { email: input.email } : {}),
        ...(input.provider ? { authProvider: input.provider } : {}),
      });
      return false;
    }

    tx.set(userRef, {
      address,
      firstLoginAt: now,
      lastLoginAt: now,
      loginCount: 1,
      chainId,
      connector,
      signupCreditsGranted: 0,
      ...(input.email ? { email: input.email } : {}),
      ...(input.provider ? { authProvider: input.provider } : {}),
    });
    return true;
  });

  if (!isNewUser) return { ok: true, newUser: false, creditsGranted: 0 };

  // 2) Best-effort one-time signup grant. A failure here leaves the user
  //    recorded (step 1) and just logs — the reconcile sweep / a later login
  //    do not retry the grant, so this is the one place it can be lost, which
  //    is the right trade vs. dropping the user from platform stats.
  let creditsGranted = 0;
  try {
    creditsGranted = await db.runTransaction(async (tx) => {
      const userRef = db.collection('users').doc(address);
      const userDoc = await tx.get(userRef);
      if (!userDoc.exists || (userDoc.data()?.signupCreditsGranted || 0) > 0) return 0;

      await grantCreditsInTxn(
        tx,
        address,
        SIGNUP_CREDIT_GRANT,
        'signup',
        'Welcome bonus — free credits to get started'
      );
      tx.update(userRef, { signupCreditsGranted: SIGNUP_CREDIT_GRANT });
      return SIGNUP_CREDIT_GRANT;
    });
  } catch (err) {
    console.error('[recordLogin] signup credit grant failed (user still recorded):', err);
  }

  return { ok: true, newUser: true, creditsGranted };
}

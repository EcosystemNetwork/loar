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
 */
export const SIGNUP_CREDIT_GRANT = Number(process.env.SIGNUP_CREDIT_GRANT ?? 500);

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
 * granting signup credits atomically on first login. Idempotent per address:
 * calling it on every login just bumps `lastLoginAt` / `loginCount`. Safe to
 * call from multiple entrypoints for the same session — the transaction stops
 * two concurrent first logins from double-granting.
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

    await grantCreditsInTxn(
      tx,
      address,
      SIGNUP_CREDIT_GRANT,
      'signup',
      'Welcome bonus — free credits to get started'
    );

    tx.set(userRef, {
      address,
      firstLoginAt: now,
      lastLoginAt: now,
      loginCount: 1,
      chainId,
      connector,
      signupCreditsGranted: SIGNUP_CREDIT_GRANT,
      ...(input.email ? { email: input.email } : {}),
      ...(input.provider ? { authProvider: input.provider } : {}),
    });
    return true;
  });

  return {
    ok: true,
    newUser: isNewUser,
    creditsGranted: isNewUser ? SIGNUP_CREDIT_GRANT : 0,
  };
}

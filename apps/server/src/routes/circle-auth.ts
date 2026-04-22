/**
 * Circle Auth Routes — Email / Social Login with Developer Controlled Wallets
 *
 * POST /auth/circle/register    — Register with email, get OTP sent
 * POST /auth/circle/verify-otp  — Verify OTP, create Circle wallet, issue JWT
 * POST /auth/circle/social      — Google social login (idToken → wallet + JWT)
 * GET  /auth/circle/me          — Current session info
 *
 * Each user gets a Circle-managed EOA wallet. The server holds the signing keys
 * via Circle's KMS — users only need email/social credentials.
 */
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { issueSessionToken } from '../lib/siwe';
import { getOrCreateWallet, isCircleConfigured, type CircleWallet } from '../lib/circle-wallets';
import { verifyGoogleIdToken, isGoogleOAuthConfigured } from '../lib/oauth-verify';
import { recordAuthEvent } from '../lib/metrics';
import { db, firebaseAvailable } from '../lib/firebase';
import crypto from 'node:crypto';

export const circleAuthRoutes = new Hono();

const IS_DEV_OR_TEST = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
const IS_PRODUCTION = !IS_DEV_OR_TEST;
const COOKIE_NAME = 'siwe-session'; // reuse same cookie name for session continuity
const COOKIE_MAX_AGE = 24 * 60 * 60;

// ── OTP storage ─────────────────────────────────────────────────────────────

const OTP_TTL = 5 * 60 * 1000; // 5 minutes
const OTP_LENGTH = 6;
const OTP_ISSUE_WINDOW_MS = 15 * 60 * 1000; // 15-min rolling issuance cap
const OTP_ISSUE_MAX = 3; // max OTP emails per 15 min per email

// HMAC key for OTP hashing — reuses SIWE_JWT_SECRET so we don't introduce a
// new secret to rotate. Falls back to a random per-process key in dev so
// tests still work without real config.
const OTP_HMAC_KEY = process.env.SIWE_JWT_SECRET ?? crypto.randomBytes(32).toString('hex');

function hashOTP(code: string, email: string): string {
  return crypto.createHmac('sha256', OTP_HMAC_KEY).update(`${email}:${code}`).digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return crypto.timingSafeEqual(ab, bb);
}

// In-memory OTP store (local dev fallback). `code` here is already the hash.
interface OTPRecord {
  hash: string;
  expiresAt: number;
  attempts: number;
  issuedAt: number;
}
const memOtps = new Map<string, OTPRecord>();
// Separate rolling-window issuance log per email (timestamps of each issue).
const memIssueLog = new Map<string, number[]>();

// Clean up expired OTPs + old issuance log entries.
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of memOtps) {
    if (now > val.expiresAt) memOtps.delete(key);
  }
  for (const [key, times] of memIssueLog) {
    const fresh = times.filter((t) => now - t < OTP_ISSUE_WINDOW_MS);
    if (fresh.length) memIssueLog.set(key, fresh);
    else memIssueLog.delete(key);
  }
}, 60_000);

function generateOTP(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(OTP_LENGTH)))
    .map((b) => (b % 10).toString())
    .join('');
}

/**
 * Single-doc design: `authOTPIssuances/{email}` stores `{ timestamps: number[] }`
 * (ms since epoch). One read/write per issuance, filtered in-memory by the
 * 15-min window. Avoids a composite index on (email, issuedAt) and bounds
 * Firestore cost regardless of how many historical issuances exist.
 */
async function readIssuanceTimestamps(email: string): Promise<number[]> {
  if (firebaseAvailable) {
    const doc = await db.collection('authOTPIssuances').doc(email).get();
    const raw = (doc.exists ? (doc.data()?.timestamps as unknown) : []) ?? [];
    return Array.isArray(raw) ? raw.filter((t): t is number => typeof t === 'number') : [];
  }
  return memIssueLog.get(email) ?? [];
}

async function canIssueOTP(email: string): Promise<boolean> {
  const now = Date.now();
  const all = await readIssuanceTimestamps(email);
  const fresh = all.filter((t) => now - t < OTP_ISSUE_WINDOW_MS);
  return fresh.length < OTP_ISSUE_MAX;
}

async function recordIssuance(email: string): Promise<void> {
  const now = Date.now();
  const all = await readIssuanceTimestamps(email);
  const fresh = all.filter((t) => now - t < OTP_ISSUE_WINDOW_MS);
  fresh.push(now);

  if (firebaseAvailable) {
    await db
      .collection('authOTPIssuances')
      .doc(email)
      .set({ timestamps: fresh, updatedAt: new Date() });
    return;
  }
  memIssueLog.set(email, fresh);
}

async function storeOTP(email: string, code: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const expiresAt = Date.now() + OTP_TTL;
  const hash = hashOTP(code, normalizedEmail);

  if (firebaseAvailable) {
    await db
      .collection('authOTPs')
      .doc(normalizedEmail)
      .set({
        hash,
        expiresAt: new Date(expiresAt),
        attempts: 0,
        createdAt: new Date(),
      });
  } else {
    memOtps.set(normalizedEmail, {
      hash,
      expiresAt,
      attempts: 0,
      issuedAt: Date.now(),
    });
  }
}

async function verifyOTP(email: string, code: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  const candidate = hashOTP(code, normalizedEmail);

  if (firebaseAvailable) {
    const ref = db.collection('authOTPs').doc(normalizedEmail);
    const doc = await ref.get();
    if (!doc.exists) return false;

    const data = doc.data()!;
    if (data.attempts >= 5) {
      await ref.delete();
      return false;
    }
    if (new Date() > data.expiresAt.toDate()) {
      await ref.delete();
      return false;
    }
    // Legacy plaintext migration: if an old doc still has `code`, compare
    // against it once so active OTPs survive the deploy. Safe to remove after
    // 5 min (OTP TTL) post-deploy.
    const stored: string | undefined = data.hash ?? data.code;
    if (!stored || !constantTimeEqual(stored, data.hash ? candidate : code)) {
      await ref.update({ attempts: data.attempts + 1 });
      return false;
    }

    await ref.delete();
    return true;
  }

  const entry = memOtps.get(normalizedEmail);
  if (!entry) return false;
  if (entry.attempts >= 5 || Date.now() > entry.expiresAt) {
    memOtps.delete(normalizedEmail);
    return false;
  }
  if (!constantTimeEqual(entry.hash, candidate)) {
    entry.attempts++;
    return false;
  }
  memOtps.delete(normalizedEmail);
  return true;
}

// ── User accounts ───────────────────────────────────────────────────────────

interface UserAccount {
  email: string;
  walletAddress: string;
  walletId: string;
  provider: 'email' | 'google';
  createdAt: Date;
}

/**
 * Two concurrent logins for the same email must end up on the same wallet.
 * `getOrCreateWallet` handles Circle-wallet-side dedup; here we dedup the
 * UserAccount write by using `create()` as a compare-and-set — it rejects
 * with ALREADY_EXISTS (gRPC code 6) on race, in which case we read the
 * winner's doc and return that.
 */
async function getOrCreateUserAccount(
  email: string,
  provider: 'email' | 'google' = 'email'
): Promise<{ account: UserAccount; wallet: CircleWallet }> {
  const normalizedEmail = email.toLowerCase().trim();
  const userId = `email:${normalizedEmail}`;

  if (firebaseAvailable) {
    const ref = db.collection('userAccounts').doc(normalizedEmail);
    const existing = await ref.get();
    if (existing.exists) {
      const account = existing.data() as UserAccount;
      const wallet = await getOrCreateWallet(userId);
      return { account, wallet };
    }

    const wallet = await getOrCreateWallet(userId);
    const account: UserAccount = {
      email: normalizedEmail,
      walletAddress: wallet.address,
      walletId: wallet.walletId,
      provider,
      createdAt: new Date(),
    };

    try {
      await ref.create(account);
      return { account, wallet };
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 6) {
        const winner = await ref.get();
        if (winner.exists) {
          return { account: winner.data() as UserAccount, wallet };
        }
      }
      throw err;
    }
  }

  // Dev/test fallback — no Firestore, no cross-request race.
  const wallet = await getOrCreateWallet(userId);
  const account: UserAccount = {
    email: normalizedEmail,
    walletAddress: wallet.address,
    walletId: wallet.walletId,
    provider,
    createdAt: new Date(),
  };
  return { account, wallet };
}

// ── Cookie helpers ──────────────────────────────────────────────────────────

function setSessionCookie(c: any, token: string) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_DEV_OR_TEST ? 'Lax' : 'Strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /auth/circle/register
 *
 * Send an OTP to the user's email. Creates the account + wallet on verify.
 */
circleAuthRoutes.post('/register', async (c) => {
  if (!isCircleConfigured()) {
    return c.json({ error: 'Circle wallets not configured' }, 503);
  }

  const body = await c.req.json<{ email: string }>();
  const email = body.email?.toLowerCase().trim();

  if (!email || !email.includes('@') || email.length > 255) {
    return c.json({ error: 'Invalid email address' }, 400);
  }

  try {
    // Per-email issuance cap — prevents email bombing + verifier brute-force
    // via repeated re-issues. Return 200 with the same success shape so the
    // response doesn't double as an account-existence oracle.
    if (!(await canIssueOTP(email))) {
      recordAuthEvent('circle_register', 'failure');
      return c.json({ ok: true, email, throttled: true });
    }

    const otp = generateOTP();
    await storeOTP(email, otp);
    await recordIssuance(email);

    // In production, send via email service (SendGrid, SES, etc.)
    // For now, log it in dev and return a success indicator
    if (IS_DEV_OR_TEST) {
      console.log(`[AUTH] OTP for ${email}: ${otp}`);
      // In dev, also return the OTP for testing convenience
      return c.json({ ok: true, email, _devOtp: otp });
    }

    // TODO: Integrate email sending service
    // await sendOtpEmail(email, otp);

    recordAuthEvent('circle_register', 'success');
    return c.json({ ok: true, email });
  } catch (err) {
    recordAuthEvent('circle_register', 'failure');
    console.error('[AUTH] OTP generation failed:', err);
    return c.json({ error: 'Failed to send verification code' }, 500);
  }
});

/**
 * POST /auth/circle/verify-otp
 *
 * Verify the OTP, create wallet if needed, issue JWT session.
 */
circleAuthRoutes.post('/verify-otp', async (c) => {
  if (!isCircleConfigured()) {
    return c.json({ error: 'Circle wallets not configured' }, 503);
  }

  const body = await c.req.json<{ email: string; code: string }>();
  const email = body.email?.toLowerCase().trim();
  const code = body.code?.trim();

  if (!email || !code) {
    return c.json({ error: 'Email and code are required' }, 400);
  }

  try {
    const valid = await verifyOTP(email, code);
    if (!valid) {
      recordAuthEvent('circle_verify', 'failure');
      return c.json({ error: 'Invalid or expired verification code' }, 401);
    }

    // Create or retrieve wallet
    const { account, wallet } = await getOrCreateUserAccount(email, 'email');

    // Issue JWT using the same session infrastructure as SIWE
    // The JWT sub is the wallet address — all downstream auth checks work unchanged
    const token = await issueSessionToken(wallet.address);
    setSessionCookie(c, token);

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());

    recordAuthEvent('circle_verify', 'success');

    // PostHog tracking
    void import('../lib/analytics').then(({ captureServerEvent }) =>
      captureServerEvent('auth:circle_login', {
        distinctId: wallet.address,
        provider: 'email',
        email,
      })
    );

    return c.json({
      address: wallet.address,
      email,
      walletId: wallet.walletId,
      expiresAt: payload.exp * 1000,
    });
  } catch (err) {
    recordAuthEvent('circle_verify', 'failure');
    console.error('[AUTH] Circle verify-otp failed:', err);
    return c.json({ error: 'Verification failed' }, 500);
  }
});

/**
 * POST /auth/circle/social
 *
 * Social login — the client performs Google OAuth and posts the
 * resulting ID token here. We verify it server-side against the provider's
 * JWKS before issuing a wallet/session, so a caller cannot simply POST
 * { email: "victim@example.com" } to take over an account.
 */
circleAuthRoutes.post('/social', async (c) => {
  if (!isCircleConfigured()) {
    return c.json({ error: 'Circle wallets not configured' }, 503);
  }

  const body = await c.req.json<{
    provider: 'google';
    idToken?: string;
  }>();

  const provider = body.provider;
  const idToken = body.idToken?.trim();

  if (provider !== 'google') {
    return c.json({ error: 'provider must be "google"' }, 400);
  }
  if (!idToken) {
    return c.json({ error: 'idToken is required' }, 400);
  }
  if (!isGoogleOAuthConfigured()) {
    return c.json({ error: 'Google OAuth not configured on this server' }, 503);
  }

  let verified;
  try {
    verified = await verifyGoogleIdToken(idToken);
  } catch (err) {
    recordAuthEvent('circle_social', 'failure');
    const message = err instanceof Error ? err.message : 'idToken verification failed';
    console.warn('[AUTH] social idToken rejected:', message);
    return c.json({ error: 'Invalid idToken' }, 401);
  }

  if (!verified.emailVerified) {
    recordAuthEvent('circle_social', 'failure');
    return c.json({ error: 'Email is not verified by provider' }, 401);
  }

  const email = verified.email;

  try {
    const { account, wallet } = await getOrCreateUserAccount(email, provider);
    const token = await issueSessionToken(wallet.address);
    setSessionCookie(c, token);

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());

    recordAuthEvent('circle_social', 'success');

    void import('../lib/analytics').then(({ captureServerEvent }) =>
      captureServerEvent('auth:circle_login', {
        distinctId: wallet.address,
        provider,
        email,
      })
    );

    return c.json({
      address: wallet.address,
      email,
      walletId: wallet.walletId,
      expiresAt: payload.exp * 1000,
    });
  } catch (err) {
    recordAuthEvent('circle_social', 'failure');
    console.error('[AUTH] Circle social login failed:', err);
    return c.json({ error: 'Social login failed' }, 500);
  }
});

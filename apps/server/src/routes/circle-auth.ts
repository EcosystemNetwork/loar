/**
 * Circle Auth Routes — Email / Social Login with Developer Controlled Wallets
 *
 * POST /auth/circle/register    — Register with email, get OTP sent
 * POST /auth/circle/verify-otp  — Verify OTP, create Circle wallet, issue JWT
 * POST /auth/circle/social      — Social login (Google/Apple token → wallet + JWT)
 * GET  /auth/circle/me          — Current session info
 *
 * Each user gets a Circle-managed EOA wallet. The server holds the signing keys
 * via Circle's KMS — users only need email/social credentials.
 */
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { issueSessionToken, verifySessionToken } from '../lib/siwe';
import { getOrCreateWallet, isCircleConfigured, type CircleWallet } from '../lib/circle-wallets';
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

// In-memory OTP store (local dev fallback)
const memOtps = new Map<string, { code: string; expiresAt: number; attempts: number }>();

// Clean up expired OTPs
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of memOtps) {
    if (now > val.expiresAt) memOtps.delete(key);
  }
}, 60_000);

function generateOTP(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(OTP_LENGTH)))
    .map((b) => (b % 10).toString())
    .join('');
}

async function storeOTP(email: string, code: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const expiresAt = Date.now() + OTP_TTL;

  if (firebaseAvailable) {
    await db
      .collection('authOTPs')
      .doc(normalizedEmail)
      .set({
        code,
        expiresAt: new Date(expiresAt),
        attempts: 0,
        createdAt: new Date(),
      });
  } else {
    memOtps.set(normalizedEmail, { code, expiresAt, attempts: 0 });
  }
}

async function verifyOTP(email: string, code: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();

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
    if (data.code !== code) {
      await ref.update({ attempts: data.attempts + 1 });
      return false;
    }

    // OTP is valid — delete it (one-time use)
    await ref.delete();
    return true;
  } else {
    const entry = memOtps.get(normalizedEmail);
    if (!entry) return false;
    if (entry.attempts >= 5 || Date.now() > entry.expiresAt) {
      memOtps.delete(normalizedEmail);
      return false;
    }
    if (entry.code !== code) {
      entry.attempts++;
      return false;
    }
    memOtps.delete(normalizedEmail);
    return true;
  }
}

// ── User accounts ───────────────────────────────────────────────────────────

interface UserAccount {
  email: string;
  walletAddress: string;
  walletId: string;
  provider: 'email' | 'google' | 'apple';
  createdAt: Date;
}

async function getOrCreateUserAccount(
  email: string,
  provider: 'email' | 'google' | 'apple' = 'email'
): Promise<{ account: UserAccount; wallet: CircleWallet }> {
  const normalizedEmail = email.toLowerCase().trim();
  // Use email hash as userId for Circle wallet mapping
  const userId = `email:${normalizedEmail}`;

  // Check if user exists
  if (firebaseAvailable) {
    const userDoc = await db.collection('userAccounts').doc(normalizedEmail).get();
    if (userDoc.exists) {
      const account = userDoc.data() as UserAccount;
      const wallet = await getOrCreateWallet(userId);
      return { account, wallet };
    }
  }

  // Create new Circle wallet for user
  const wallet = await getOrCreateWallet(userId);

  const account: UserAccount = {
    email: normalizedEmail,
    walletAddress: wallet.address,
    walletId: wallet.walletId,
    provider,
    createdAt: new Date(),
  };

  if (firebaseAvailable) {
    await db.collection('userAccounts').doc(normalizedEmail).set(account);
  }

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
    const otp = generateOTP();
    await storeOTP(email, otp);

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
 * Social login — accepts a verified token from Google/Apple OAuth.
 * The frontend handles the OAuth flow and sends the verified email here.
 *
 * In a full implementation, this would verify the OAuth token server-side.
 * For now, we accept the verified email directly (TODO: add token verification).
 */
circleAuthRoutes.post('/social', async (c) => {
  if (!isCircleConfigured()) {
    return c.json({ error: 'Circle wallets not configured' }, 503);
  }

  const body = await c.req.json<{
    email: string;
    provider: 'google' | 'apple';
    idToken?: string;
  }>();

  const email = body.email?.toLowerCase().trim();
  const provider = body.provider;

  if (!email || !provider) {
    return c.json({ error: 'Email and provider are required' }, 400);
  }

  // TODO: Verify OAuth idToken with Google/Apple
  // For now, trust the email from the frontend OAuth flow
  // In production, this MUST verify the idToken server-side

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

/**
 * OAuth ID-token verification for social login.
 *
 * Verifies Google / Apple ID tokens server-side so we can trust the email
 * before issuing a Circle wallet + session. Never trust client-supplied
 * email — it enables trivial account takeover.
 */
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface VerifiedIdentity {
  email: string;
  emailVerified: boolean;
  subject: string;
  provider: 'google' | 'apple';
}

// ── Google ──────────────────────────────────────────────────────────────────

let _googleClient: OAuth2Client | null = null;
function googleClient(): OAuth2Client {
  if (_googleClient) return _googleClient;
  _googleClient = new OAuth2Client();
  return _googleClient;
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedIdentity> {
  const audience = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!audience) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID not configured');
  }

  const ticket = await googleClient().verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (!payload) throw new Error('Google token payload missing');

  const { email, email_verified, sub } = payload;
  if (!email) throw new Error('Google token has no email claim');
  if (!sub) throw new Error('Google token has no subject claim');

  return {
    email: email.toLowerCase(),
    emailVerified: !!email_verified,
    subject: sub,
    provider: 'google',
  };
}

// ── Apple ───────────────────────────────────────────────────────────────────

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

let _appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function appleJwks() {
  if (_appleJwks) return _appleJwks;
  _appleJwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  return _appleJwks;
}

export async function verifyAppleIdToken(idToken: string): Promise<VerifiedIdentity> {
  const audience = process.env.APPLE_OAUTH_CLIENT_ID;
  if (!audience) {
    throw new Error('APPLE_OAUTH_CLIENT_ID not configured');
  }

  const { payload } = await jwtVerify(idToken, appleJwks(), {
    issuer: APPLE_ISSUER,
    audience,
  });

  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
  const emailVerifiedRaw = payload.email_verified;
  // Apple encodes email_verified as either boolean or the literal string "true".
  const emailVerified = emailVerifiedRaw === true || emailVerifiedRaw === 'true';

  if (!email) throw new Error('Apple token has no email claim');
  if (!sub) throw new Error('Apple token has no subject claim');

  return {
    email: email.toLowerCase(),
    emailVerified,
    subject: sub,
    provider: 'apple',
  };
}

export function isGoogleOAuthConfigured(): boolean {
  return !!process.env.GOOGLE_OAUTH_CLIENT_ID;
}

export function isAppleOAuthConfigured(): boolean {
  return !!process.env.APPLE_OAUTH_CLIENT_ID;
}

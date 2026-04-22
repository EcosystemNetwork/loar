/**
 * OAuth ID-token verification for social login.
 *
 * Verifies Google ID tokens server-side so we can trust the email before
 * issuing a Circle wallet + session. Never trust client-supplied email —
 * it enables trivial account takeover.
 */
import { OAuth2Client } from 'google-auth-library';

export interface VerifiedIdentity {
  email: string;
  emailVerified: boolean;
  subject: string;
  provider: 'google';
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

export function isGoogleOAuthConfigured(): boolean {
  return !!process.env.GOOGLE_OAUTH_CLIENT_ID;
}

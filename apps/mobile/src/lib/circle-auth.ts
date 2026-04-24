/**
 * Circle Developer Controlled Wallets — mobile auth client.
 *
 * Pure HTTP client for the server's `/auth/circle/*` endpoints. Mirrors
 * the web's `wallet-auth.ts` API surface (requestEmailOTP → verifyEmailOTP
 * or socialLogin) but uses SecureStore-backed JWT instead of httpOnly
 * cookies (a native app has no browser cookie jar to rely on).
 *
 * The server returns a bearer JWT whose `sub` is the Circle-managed EOA
 * address — identical shape to the old SIWE token, so downstream tRPC auth
 * works without any server-side changes. The `X-Mobile-Client: 1` header
 * tells the server to echo the token in the JSON body.
 */
const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:3000';

export interface CircleAuthResult {
  token: string;
  address: string;
  email: string;
  walletId: string;
  expiresAt: number;
}

interface ServerErrorBody {
  error?: string;
}

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as ServerErrorBody;
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export async function requestEmailOTP(
  email: string
): Promise<{ ok: boolean; throttled?: boolean; _devOtp?: string }> {
  const res = await fetch(`${SERVER_URL}/auth/circle/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, 'Failed to send verification code'));
  }
  return res.json();
}

export async function verifyEmailOTP(email: string, code: string): Promise<CircleAuthResult> {
  const res = await fetch(`${SERVER_URL}/auth/circle/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mobile-Client': '1' },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, 'Invalid or expired verification code'));
  }
  return parseAuthBody(await res.json());
}

export async function socialLogin(provider: 'google', idToken: string): Promise<CircleAuthResult> {
  const res = await fetch(`${SERVER_URL}/auth/circle/social`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mobile-Client': '1' },
    body: JSON.stringify({ provider, idToken }),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, 'Social login failed'));
  }
  return parseAuthBody(await res.json());
}

function parseAuthBody(body: unknown): CircleAuthResult {
  const b = body as Partial<CircleAuthResult>;
  if (!b.token) {
    throw new Error('Server did not return a session token');
  }
  if (!b.address || !b.email || !b.walletId || typeof b.expiresAt !== 'number') {
    throw new Error('Incomplete auth payload from server');
  }
  return {
    token: b.token,
    address: b.address,
    email: b.email,
    walletId: b.walletId,
    expiresAt: b.expiresAt,
  };
}

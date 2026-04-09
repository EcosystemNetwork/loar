/**
 * EVM Authentication Verification
 *
 * Verifies JWT session tokens from EVM (SIWE) wallet authentication.
 * Returns a normalized user object for use in tRPC context.
 */
import { verifySessionToken } from './siwe';

export interface AuthUser {
  uid: string;
  address?: string;
  email?: string;
}

export async function verifyAuth(headers: Headers): Promise<AuthUser | null> {
  const token = headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (payload?.sub) {
    const uid = payload.sub.toLowerCase();
    return {
      uid,
      address: payload.sub,
    };
  }

  return null;
}

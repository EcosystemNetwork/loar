/**
 * Authentication verification.
 * Verifies SIWE JWT session tokens from CDP wallet authentication.
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

  const siwePayload = await verifySessionToken(token);
  if (siwePayload?.sub) {
    return {
      uid: siwePayload.sub.toLowerCase(),
      address: siwePayload.sub,
    };
  }

  return null;
}

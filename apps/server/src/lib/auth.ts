/**
 * Unified authentication verification.
 * Supports SIWE JWT (primary) and Firebase ID tokens (legacy fallback).
 * Returns a normalized user object for use in tRPC context.
 */
import { verifySessionToken } from './siwe';
import { adminAuth } from './firebase';

export interface AuthUser {
  uid: string;
  address?: string;
  email?: string;
}

export async function verifyAuth(headers: Headers): Promise<AuthUser | null> {
  const token = headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;

  // Try SIWE JWT first (most common path going forward)
  const siwePayload = await verifySessionToken(token);
  if (siwePayload?.sub) {
    return {
      uid: siwePayload.sub.toLowerCase(),
      address: siwePayload.sub,
    };
  }

  // Fallback: Firebase ID token (legacy clients)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
    };
  } catch {
    return null;
  }
}

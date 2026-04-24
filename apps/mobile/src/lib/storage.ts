/**
 * Secure storage helpers using expo-secure-store.
 *
 * Persists the Circle session: JWT + wallet address + email. Each value
 * is pinned to `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` so the bearer token
 * can't iCloud-sync off-device.
 */
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'siwe-token'; // kept for continuity with old builds
const ADDRESS_KEY = 'siwe-address';
const EMAIL_KEY = 'circle-email';
const EXPIRY_KEY = 'circle-expiry';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export interface StoredSession {
  token: string;
  address: string;
  email: string | null;
  expiresAt: number | null;
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTS);
}

export async function getStoredAddress(): Promise<string | null> {
  return SecureStore.getItemAsync(ADDRESS_KEY, SECURE_OPTS);
}

export async function getStoredSession(): Promise<StoredSession | null> {
  const [token, address, email, expiryRaw] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTS),
    SecureStore.getItemAsync(ADDRESS_KEY, SECURE_OPTS),
    SecureStore.getItemAsync(EMAIL_KEY, SECURE_OPTS),
    SecureStore.getItemAsync(EXPIRY_KEY, SECURE_OPTS),
  ]);
  if (!token || !address) return null;
  const expiresAt = expiryRaw ? Number(expiryRaw) : null;
  if (expiresAt && Date.now() >= expiresAt) return null;
  return { token, address, email, expiresAt };
}

export async function setSession(params: {
  token: string;
  address: string;
  email?: string;
  expiresAt?: number;
}): Promise<void> {
  const writes: Array<Promise<unknown>> = [
    SecureStore.setItemAsync(TOKEN_KEY, params.token, SECURE_OPTS),
    SecureStore.setItemAsync(ADDRESS_KEY, params.address, SECURE_OPTS),
  ];
  if (params.email) {
    writes.push(SecureStore.setItemAsync(EMAIL_KEY, params.email, SECURE_OPTS));
  }
  if (typeof params.expiresAt === 'number') {
    writes.push(SecureStore.setItemAsync(EXPIRY_KEY, String(params.expiresAt), SECURE_OPTS));
  }
  await Promise.all(writes);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_OPTS),
    SecureStore.deleteItemAsync(ADDRESS_KEY, SECURE_OPTS),
    SecureStore.deleteItemAsync(EMAIL_KEY, SECURE_OPTS),
    SecureStore.deleteItemAsync(EXPIRY_KEY, SECURE_OPTS),
  ]);
}

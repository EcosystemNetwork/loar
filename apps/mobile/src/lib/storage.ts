/**
 * Secure storage helpers using expo-secure-store.
 * Replaces localStorage from the web app.
 */
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'siwe-token';
const ADDRESS_KEY = 'siwe-address';

// Default SecureStore options on iOS put the item in the keychain with
// `WHEN_UNLOCKED` accessibility, which makes it iCloud-Keychain-syncable. A
// bearer JWT that grants full tRPC access must not leave the device — pin it
// to `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. Same flag is a no-op on Android
// but expo-secure-store accepts it silently.
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTS);
}

export async function getStoredAddress(): Promise<string | null> {
  return SecureStore.getItemAsync(ADDRESS_KEY, SECURE_OPTS);
}

export async function setSession(token: string, address: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token, SECURE_OPTS),
    SecureStore.setItemAsync(ADDRESS_KEY, address, SECURE_OPTS),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_OPTS),
    SecureStore.deleteItemAsync(ADDRESS_KEY, SECURE_OPTS),
  ]);
}

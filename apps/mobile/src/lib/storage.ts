/**
 * Secure storage helpers using expo-secure-store.
 * Replaces localStorage from the web app.
 */
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'siwe-token';
const ADDRESS_KEY = 'siwe-address';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getStoredAddress(): Promise<string | null> {
  return SecureStore.getItemAsync(ADDRESS_KEY);
}

export async function setSession(token: string, address: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(ADDRESS_KEY, address),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(ADDRESS_KEY),
  ]);
}

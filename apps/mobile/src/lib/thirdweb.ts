/**
 * thirdweb wallet integration for mobile.
 *
 * Mirrors apps/web's thirdweb setup: a single `inAppWallet` that supports
 * Google / Apple / passkey / email login plus external wallets (MetaMask,
 * Coinbase Wallet, etc.) via WalletConnect-style deep links.
 *
 * Setup:
 *  1. Install thirdweb + peers (see package.json)
 *  2. Set EXPO_PUBLIC_THIRDWEB_CLIENT_ID in your .env (free at thirdweb.com/dashboard)
 *  3. The `loarvault://` scheme in app.json handles OAuth return deep links
 */
import { createThirdwebClient, type ThirdwebClient } from 'thirdweb';
import { baseSepolia } from 'thirdweb/chains';
import { inAppWallet, type Wallet } from 'thirdweb/wallets';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const clientId = process.env.EXPO_PUBLIC_THIRDWEB_CLIENT_ID;

if (!clientId) {
  console.warn('[thirdweb] EXPO_PUBLIC_THIRDWEB_CLIENT_ID not set — wallet connect will fail');
}

export const thirdwebClient: ThirdwebClient = createThirdwebClient({
  clientId: clientId ?? 'placeholder',
});

/** Default chain for SIWE signatures when the wallet does not report one. */
export const DEFAULT_CHAIN = baseSepolia;

let _wallet: Wallet<'inApp'> | null = null;

function getWallet(): Wallet<'inApp'> {
  if (!_wallet) {
    _wallet = inAppWallet({
      auth: {
        options: ['google', 'apple', 'passkey', 'email'],
        redirectUrl: 'loarvault://',
      },
    });
  }
  return _wallet;
}

export type ConnectStrategy = 'google' | 'apple' | 'passkey' | 'email';

// OAuth-state nonce store: written before triggering the deep-link OAuth
// round-trip, validated when the in-app wallet returns. Without this, an
// attacker who hijacks the `loarvault://` scheme (Android custom-scheme
// races) could feed a forged OAuth callback into the wallet resume flow.
const OAUTH_STATE_KEY = 'oauth-attempt-state';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface OAuthStateRecord {
  nonce: string;
  startedAt: number;
  strategy: ConnectStrategy;
}

async function beginOAuthAttempt(strategy: ConnectStrategy): Promise<string> {
  const nonce = Crypto.randomUUID();
  const record: OAuthStateRecord = { nonce, startedAt: Date.now(), strategy };
  await SecureStore.setItemAsync(OAUTH_STATE_KEY, JSON.stringify(record), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return nonce;
}

async function validateOAuthAttempt(strategy: ConnectStrategy): Promise<void> {
  const raw = await SecureStore.getItemAsync(OAUTH_STATE_KEY, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  // Always consume the state record — single use, even on failure.
  await SecureStore.deleteItemAsync(OAUTH_STATE_KEY).catch(() => undefined);
  if (!raw) {
    throw new Error(
      'OAuth callback received without matching attempt state — possible deep-link hijack'
    );
  }
  let parsed: OAuthStateRecord;
  try {
    parsed = JSON.parse(raw) as OAuthStateRecord;
  } catch {
    throw new Error('OAuth attempt state corrupted — refusing to proceed');
  }
  if (parsed.strategy !== strategy) {
    throw new Error('OAuth callback strategy mismatch — refusing to proceed');
  }
  if (Date.now() - parsed.startedAt > OAUTH_STATE_TTL_MS) {
    throw new Error('OAuth attempt expired — please retry sign-in');
  }
}

/**
 * Connect via an in-app wallet (Google / Apple / passkey / email).
 * Deep-links out to the OAuth provider when needed and returns the address.
 */
export async function connectWallet(strategy: ConnectStrategy = 'google'): Promise<string> {
  const wallet = getWallet();
  // Bind this OAuth round-trip to a single-use nonce stored in SecureStore.
  // Validated post-callback so a hijacked deep-link cannot inject a foreign
  // OAuth response into the resumed wallet flow.
  await beginOAuthAttempt(strategy);
  let account;
  try {
    account = await wallet.connect({
      client: thirdwebClient,
      strategy,
    } as Parameters<typeof wallet.connect>[0]);
  } catch (err) {
    // Drop the state on failure so a stale attempt can't be replayed.
    await SecureStore.deleteItemAsync(OAUTH_STATE_KEY).catch(() => undefined);
    throw err;
  }
  await validateOAuthAttempt(strategy);
  if (!account?.address) {
    throw new Error('Wallet connect returned no account');
  }
  return account.address;
}

/** Sign an arbitrary message (EIP-191) with the connected account. */
export async function signWithWallet(message: string): Promise<string> {
  const wallet = getWallet();
  const account = wallet.getAccount();
  if (!account) {
    throw new Error('Wallet not connected');
  }
  return account.signMessage({ message });
}

/** Current chain id from the connected wallet, or the default. */
export async function getWalletChainId(): Promise<number> {
  const wallet = getWallet();
  const chain = wallet.getChain();
  return chain?.id ?? DEFAULT_CHAIN.id;
}

/** Disconnect the active session. */
export async function disconnectWallet(): Promise<void> {
  const wallet = getWallet();
  await wallet.disconnect();
  _wallet = null;
}

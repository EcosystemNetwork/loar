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

/**
 * Connect via an in-app wallet (Google / Apple / passkey / email).
 * Deep-links out to the OAuth provider when needed and returns the address.
 */
export async function connectWallet(strategy: ConnectStrategy = 'google'): Promise<string> {
  const wallet = getWallet();
  const account = await wallet.connect({
    client: thirdwebClient,
    strategy,
  } as Parameters<typeof wallet.connect>[0]);
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

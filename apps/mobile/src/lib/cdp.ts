/**
 * Coinbase Developer Platform (CDP) wallet integration for mobile.
 *
 * Uses @coinbase/wallet-mobile-sdk which:
 *  - Deep-links into the Coinbase Wallet app (supports embedded wallets
 *    created via Google / Apple / passkeys / email on the web)
 *  - Returns an EIP-1193 compatible provider for signing SIWE messages
 *  - Mirrors the CDP embedded wallet used on the web app
 *
 * Setup:
 *  1. Install Coinbase Wallet on the device (or simulator)
 *  2. Set EXPO_PUBLIC_CDP_API_KEY in your .env
 *  3. The `loarvault://` scheme in app.json handles the return deep link
 */
import { WalletMobileSDKEVMProvider, configure } from '@coinbase/wallet-mobile-sdk';
import { Linking } from 'react-native';

const APP_DEEP_LINK = 'loarvault://';
const CALLBACK_URL = new URL('loarvault://cdp-callback');

export function initCDP() {
  configure({
    callbackURL: CALLBACK_URL,
    hostURL: new URL('https://wallet.coinbase.com/wsegue'),
    hostPackageName: 'org.toshi',
  });
}

/** Singleton provider instance. */
let _provider: WalletMobileSDKEVMProvider | null = null;

export function getCDPProvider(): WalletMobileSDKEVMProvider {
  if (!_provider) {
    _provider = new WalletMobileSDKEVMProvider();
  }
  return _provider;
}

/**
 * Request wallet connection and return the connected address.
 * Deep-links into Coinbase Wallet for the user to approve.
 */
export async function connectCDPWallet(): Promise<string> {
  const provider = getCDPProvider();

  // EIP-1193 eth_requestAccounts
  const accounts = await provider.request({
    method: 'eth_requestAccounts',
  }) as string[];

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned from wallet');
  }

  return accounts[0];
}

/**
 * Sign a message with the connected wallet.
 * Uses personal_sign (EIP-191) which is what SIWE requires.
 */
export async function signWithCDP(message: string, address: string): Promise<string> {
  const provider = getCDPProvider();

  const signature = await provider.request({
    method: 'personal_sign',
    params: [message, address],
  }) as string;

  return signature;
}

/** Get the current chain ID from the connected wallet. */
export async function getCDPChainId(): Promise<number> {
  const provider = getCDPProvider();
  const chainIdHex = await provider.request({ method: 'eth_chainId' }) as string;
  return parseInt(chainIdHex, 16);
}

/** Disconnect the CDP wallet session. */
export async function disconnectCDP(): Promise<void> {
  const provider = getCDPProvider();
  await provider.disconnect();
  _provider = null;
}

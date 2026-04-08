/**
 * SUI wallet authentication using Sign-In With SUI.
 *
 * Parallel to solana-auth.ts (SIWS) and wallet-auth.ts (SIWE). All three
 * produce the same JWT format — the server doesn't care which chain the
 * user authenticated from.
 *
 * Flow: connect SUI wallet → fetch nonce → sign personal message → verify → store JWT
 */
import { useState, useCallback, useSyncExternalStore } from 'react';
import { useCurrentAccount, useDisconnectWallet, useSignPersonalMessage } from '@mysten/dapp-kit';

const TOKEN_KEY = 'siwe-token'; // shared key — same session store as EVM/Solana
const ADDRESS_KEY = 'siwe-address';
const CHAIN_KEY = 'auth-chain'; // 'evm' | 'solana' | 'sui'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

// ── Shared reactive token storage ──────────────────────────────

let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function getServerSnapshot(): string | null {
  return null;
}

export function getSuiToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setSession(token: string, address: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ADDRESS_KEY, address);
  localStorage.setItem(CHAIN_KEY, 'sui');
  emitChange();
}

export function clearSuiSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADDRESS_KEY);
  localStorage.removeItem(CHAIN_KEY);
  emitChange();
}

/** Get which chain family the current session authenticated with. */
export function getAuthChain(): 'evm' | 'solana' | 'sui' | null {
  return localStorage.getItem(CHAIN_KEY) as 'evm' | 'solana' | 'sui' | null;
}

// ── Message construction ──────────────────────────────────────

function buildSuiSignInMessage(params: { address: string; nonce: string }) {
  const domain = window.location.host;
  const uri = window.location.origin;
  const now = new Date().toISOString();

  return [
    `${domain} wants you to sign in with your SUI account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: sui`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now}`,
  ].join('\n');
}

// ── Handshake ─────────────────────────────────────────────────

async function fetchNonce(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!res.ok) throw new Error('Failed to fetch nonce');
  const data = await res.json();
  return data.nonce;
}

async function verifySignature(
  message: string,
  signature: string,
  address: string
): Promise<{ token: string; address: string }> {
  const res = await fetch(`${SERVER_URL}/auth/verify-sui`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature, address }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Verification failed' }));
    throw new Error(err.error || 'Verification failed');
  }
  return res.json();
}

// ── React hook ─────────────────────────────────────────────────

export function useSuiAuth() {
  const account = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const token = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = account?.address ?? null;
  const connected = Boolean(account);
  const isAuthenticated = Boolean(connected && account && token && getAuthChain() === 'sui');

  /** Perform the Sign-In With SUI handshake. */
  const signIn = useCallback(async () => {
    if (!account) return;

    setIsAuthenticating(true);
    setError(null);

    try {
      const nonce = await fetchNonce();
      const message = buildSuiSignInMessage({
        address: account.address,
        nonce,
      });

      const encodedMessage = new TextEncoder().encode(message);
      const { signature } = await signPersonalMessage({
        message: encodedMessage,
      });

      const result = await verifySignature(message, signature, account.address);
      setSession(result.token, result.address);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      if (!msg.includes('User rejected') && !msg.includes('user rejected')) {
        setError(msg);
      }
    } finally {
      setIsAuthenticating(false);
    }
  }, [account, signPersonalMessage]);

  /** Disconnect wallet and clear session. */
  const signOut = useCallback(() => {
    clearSuiSession();
    disconnectWallet();
  }, [disconnectWallet]);

  return {
    address,
    isConnected: connected,
    isAuthenticated,
    isAuthenticating,
    error,
    signIn,
    signOut,
  };
}

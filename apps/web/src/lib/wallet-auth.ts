/**
 * Wallet-based authentication using SIWE (Sign-In With Ethereum).
 *
 * Replaces Firebase Auth on the frontend. Works with Coinbase Smart Wallet
 * social logins (Google, passkeys, email) via wagmi.
 *
 * Flow: connect wallet → fetch nonce → sign SIWE message → verify → store JWT
 */
import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi';

const TOKEN_KEY = 'siwe-token';
const ADDRESS_KEY = 'siwe-address';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

// ── Token storage (reactive via useSyncExternalStore) ───────────

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

/** Get the current SIWE session token (synchronous, for tRPC headers). */
export function getSiweToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Get the authenticated wallet address. */
export function getSiweAddress(): string | null {
  return localStorage.getItem(ADDRESS_KEY);
}

function setSession(token: string, address: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ADDRESS_KEY, address);
  emitChange();
}

/** Clear the SIWE session from localStorage. */
export function clearSiweSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADDRESS_KEY);
  emitChange();
}

// ── SIWE message construction ───────────────────────────────────

function buildSiweMessage(params: {
  address: string;
  nonce: string;
  chainId: number;
}) {
  const domain = window.location.host;
  const uri = window.location.origin;
  const now = new Date().toISOString();

  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now}`,
  ].join('\n');
}

// ── SIWE handshake ──────────────────────────────────────────────

async function fetchNonce(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!res.ok) throw new Error('Failed to fetch nonce');
  const data = await res.json();
  return data.nonce;
}

async function verifySignature(
  message: string,
  signature: string
): Promise<{ token: string; address: string }> {
  const res = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Verification failed' }));
    throw new Error(err.error || 'Verification failed');
  }
  return res.json();
}

// ── React hook ──────────────────────────────────────────────────

export function useWalletAuth() {
  const { address, isConnected, chain } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const token = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = Boolean(isConnected && address && token);

  /** Perform the SIWE sign-in handshake. */
  const signIn = useCallback(async () => {
    if (!address || !chain) return;

    setIsAuthenticating(true);
    setError(null);

    try {
      const nonce = await fetchNonce();
      const message = buildSiweMessage({
        address,
        nonce,
        chainId: chain.id,
      });
      const signature = await signMessageAsync({ message });
      const result = await verifySignature(message, signature);
      setSession(result.token, result.address);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      // Don't set error for user rejections
      if (!msg.includes('User rejected') && !msg.includes('user rejected')) {
        setError(msg);
      }
    } finally {
      setIsAuthenticating(false);
    }
  }, [address, chain, signMessageAsync]);

  /** Disconnect wallet and clear SIWE session. */
  const signOut = useCallback(() => {
    clearSiweSession();
    disconnect();
  }, [disconnect]);

  // Auto-clear session if wallet disconnects or address changes
  useEffect(() => {
    const storedAddress = getSiweAddress();
    if (!isConnected || !address) {
      if (token) clearSiweSession();
    } else if (storedAddress && storedAddress.toLowerCase() !== address.toLowerCase()) {
      // Address changed — clear old session
      clearSiweSession();
    }
  }, [isConnected, address, token]);

  return {
    address,
    isConnected,
    isAuthenticated,
    isAuthenticating,
    error,
    signIn,
    signOut,
  };
}

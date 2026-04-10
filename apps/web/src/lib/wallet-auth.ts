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

/** Clear the SIWE session from localStorage and optionally revoke server-side. */
export function clearSiweSession(revoke = false) {
  const token = localStorage.getItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADDRESS_KEY);
  emitChange();

  // Fire-and-forget server-side revocation
  if (revoke && token) {
    fetch(`${SERVER_URL}/auth/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {}); // Best-effort
  }
}

/** Refresh the session token. Returns true if refreshed, false if expired. */
export async function refreshSession(): Promise<boolean> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return false;

  try {
    const res = await fetch(`${SERVER_URL}/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      emitChange();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Proactive session refresh — refresh 1 hour before expiry.
// JWT has 24h TTL, so refresh at the 23h mark.
setInterval(
  async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiresIn = payload.exp * 1000 - Date.now();
      if (expiresIn > 0 && expiresIn < 60 * 60 * 1000) {
        await refreshSession();
      }
    } catch {
      clearSiweSession();
    }
  },
  5 * 60 * 1000
);

// Refresh token when user returns to a backgrounded tab.
// setInterval doesn't fire reliably in inactive tabs, so this
// catches expired-or-nearly-expired tokens on tab focus.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiresIn = payload.exp * 1000 - Date.now();
      if (expiresIn <= 0) {
        clearSiweSession();
      } else if (expiresIn < 60 * 60 * 1000) {
        const ok = await refreshSession();
        if (!ok) clearSiweSession();
      }
    } catch {
      clearSiweSession();
    }
  });
}

// ── SIWE message construction ───────────────────────────────────

function buildSiweMessage(params: { address: string; nonce: string; chainId: number }) {
  const domain = window.location.host;
  const uri = window.location.origin;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

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
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
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

  /** Disconnect wallet, revoke JWT server-side, and clear SIWE session. */
  const signOut = useCallback(() => {
    clearSiweSession(true); // revoke = true
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

  // Auto-trigger SIWE sign-in when wallet connects without an existing session
  useEffect(() => {
    if (isConnected && address && chain && !token && !isAuthenticating) {
      signIn();
    }
  }, [isConnected, address, chain, token, isAuthenticating, signIn]);

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

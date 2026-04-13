/**
 * Wallet-based authentication using SIWE (Sign-In With Ethereum).
 *
 * Session tokens are stored in httpOnly cookies (set by the server).
 * The client only stores the wallet address and session expiry for UI purposes.
 * This prevents XSS attacks from stealing session tokens.
 *
 * Flow: connect wallet → fetch nonce → sign SIWE message → server sets cookie
 */
import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi';

const ADDRESS_KEY = 'siwe-address';
const EXPIRY_KEY = 'siwe-expiry';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

// ── Auth state (reactive via useSyncExternalStore) ────────────

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
  return localStorage.getItem(ADDRESS_KEY);
}

function getServerSnapshot(): string | null {
  return null;
}

/** Get the authenticated wallet address (for UI display). */
export function getSiweAddress(): string | null {
  return localStorage.getItem(ADDRESS_KEY);
}

/**
 * Check if the client believes it has a valid session.
 * Note: the actual token is in an httpOnly cookie — this is just a UI hint.
 */
export function hasSession(): boolean {
  const address = localStorage.getItem(ADDRESS_KEY);
  const expiry = localStorage.getItem(EXPIRY_KEY);
  if (!address || !expiry) return false;
  return Date.now() < Number(expiry);
}

/**
 * @deprecated Use `hasSession()` instead. Kept for backward compatibility
 * with code that checks for a token string. Returns a truthy placeholder
 * when a session exists, null otherwise.
 */
export function getSiweToken(): string | null {
  return hasSession() ? '__httpOnly__' : null;
}

function setSession(address: string, expiresAt: number) {
  localStorage.setItem(ADDRESS_KEY, address);
  localStorage.setItem(EXPIRY_KEY, String(expiresAt));
  emitChange();
}

/** Clear the SIWE session from local state and optionally revoke server-side. */
export function clearSiweSession(revoke = false) {
  localStorage.removeItem(ADDRESS_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  emitChange();

  // Fire-and-forget server-side revocation (clears httpOnly cookie)
  if (revoke) {
    fetch(`${SERVER_URL}/auth/revoke`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {}); // Best-effort
  }
}

/** Refresh the session cookie. Returns true if refreshed, false if expired. */
export async function refreshSession(): Promise<boolean> {
  if (!hasSession()) return false;

  try {
    const res = await fetch(`${SERVER_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.ok && data.expiresAt) {
      localStorage.setItem(EXPIRY_KEY, String(data.expiresAt));
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
    const expiry = localStorage.getItem(EXPIRY_KEY);
    if (!expiry) return;

    const expiresIn = Number(expiry) - Date.now();
    if (expiresIn > 0 && expiresIn < 60 * 60 * 1000) {
      await refreshSession();
    }
  },
  5 * 60 * 1000
);

// Refresh token when user returns to a backgrounded tab.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const expiry = localStorage.getItem(EXPIRY_KEY);
    if (!expiry) return;

    const expiresIn = Number(expiry) - Date.now();
    if (expiresIn <= 0) {
      clearSiweSession();
    } else if (expiresIn < 60 * 60 * 1000) {
      const ok = await refreshSession();
      if (!ok) clearSiweSession();
    }
  });
}

// ── SIWE message construction ───────────────────────────────────

function buildSiweMessage(params: { address: string; nonce: string; chainId: number }) {
  const domain = window.location.host;
  const uri = window.location.origin;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes (matches server nonce TTL)

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
  const res = await fetch(`${SERVER_URL}/auth/nonce`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch nonce');
  const data = await res.json();
  return data.nonce;
}

async function verifySignature(
  message: string,
  signature: string
): Promise<{ address: string; expiresAt: number }> {
  const res = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // receive and store httpOnly cookie
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
  const storedAddress = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether user rejected SIWE to prevent auto-sign-in loop
  const rejectedRef = useRef(false);
  // Track the last address we auto-signed for to avoid duplicate attempts
  const autoSignedForRef = useRef<string | null>(null);

  const isAuthenticated = Boolean(isConnected && address && storedAddress);

  /** Perform the SIWE sign-in handshake. */
  const signIn = useCallback(async () => {
    if (!address) return;

    setIsAuthenticating(true);
    setError(null);
    rejectedRef.current = false;

    try {
      const nonce = await fetchNonce();
      const message = buildSiweMessage({
        address,
        nonce,
        chainId: chain?.id ?? 1,
      });
      const signature = await signMessageAsync({ message });
      const result = await verifySignature(message, signature);
      setSession(result.address, result.expiresAt);
      autoSignedForRef.current = address.toLowerCase();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      // Track user rejections to prevent auto-sign-in loop
      if (msg.includes('User rejected') || msg.includes('user rejected')) {
        rejectedRef.current = true;
      } else {
        setError(msg);
      }
    } finally {
      setIsAuthenticating(false);
    }
  }, [address, chain?.id, signMessageAsync]);

  /** Disconnect wallet, revoke JWT server-side, and clear SIWE session. */
  const signOut = useCallback(() => {
    clearSiweSession(true); // revoke = true
    rejectedRef.current = false;
    autoSignedForRef.current = null;
    // wagmi disconnect triggers DynamicWagmiConnector to sync Dynamic's UI state
    disconnect();
  }, [disconnect]);

  // Auto-clear session if wallet disconnects or address changes
  useEffect(() => {
    if (!isConnected || !address) {
      if (storedAddress) clearSiweSession();
      rejectedRef.current = false;
      autoSignedForRef.current = null;
    } else if (storedAddress && storedAddress.toLowerCase() !== address.toLowerCase()) {
      // Address changed — clear old session and reset rejection flag for new address
      clearSiweSession();
      rejectedRef.current = false;
      autoSignedForRef.current = null;
    }
  }, [isConnected, address, storedAddress]);

  // Auto-trigger SIWE sign-in when wallet connects without an existing session
  useEffect(() => {
    if (
      isConnected &&
      address &&
      !storedAddress &&
      !isAuthenticating &&
      !rejectedRef.current &&
      autoSignedForRef.current !== address.toLowerCase()
    ) {
      signIn();
    }
  }, [isConnected, address, storedAddress, isAuthenticating, signIn]);

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

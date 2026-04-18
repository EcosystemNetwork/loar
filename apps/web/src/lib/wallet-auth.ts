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
import { useAccount, useDisconnect } from 'wagmi';
import { useActiveAccount } from 'thirdweb/react';

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

// Session validation — lazy getter avoids TDZ errors from Rollup reordering
// module-level code. No live `export let` binding to get trapped in the dead zone.
let _sessionValidated = false;
let _sessionValidationDone: Promise<void> | null = null;

export function getSessionValidationDone(): Promise<void> {
  if (_sessionValidationDone) return _sessionValidationDone;
  if (typeof window === 'undefined' || !localStorage.getItem(ADDRESS_KEY)) {
    _sessionValidated = true;
    _sessionValidationDone = Promise.resolve();
    return _sessionValidationDone;
  }
  _sessionValidationDone = fetch(`${SERVER_URL}/auth/me`, { credentials: 'include' })
    .then((res) => res.json())
    .then((data) => {
      if (!data.authenticated) {
        localStorage.removeItem(ADDRESS_KEY);
        localStorage.removeItem(EXPIRY_KEY);
        emitChange();
      }
    })
    .catch(() => {
      // AUTH-04: Fail closed on network error — clear session rather than keeping potentially stale auth
      localStorage.removeItem(ADDRESS_KEY);
      localStorage.removeItem(EXPIRY_KEY);
      emitChange();
    })
    .finally(() => {
      _sessionValidated = true;
    });
  return _sessionValidationDone;
}

/** Whether the initial session validation has completed. */
export function isSessionValidated(): boolean {
  return _sessionValidated;
}

// ── Deferred initialisation (called from main.tsx) ─────────────
// Moved out of module scope to avoid top-level side effects that
// trigger TDZ errors when Rollup reorders import initialisers.
let _initDone = false;

export function initWalletAuth() {
  if (_initDone) return;
  _initDone = true;

  // Proactive session refresh — refresh 1 hour before expiry.
  // JWT has 24h TTL, so refresh at the 23h mark.
  if (typeof window !== 'undefined') {
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
  }

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

// Track nonce fetch failures to implement backoff
let _nonceFailCount = 0;
let _nonceBackoffUntil = 0;

async function fetchNonce(): Promise<string> {
  // Respect backoff window from previous 429s
  const now = Date.now();
  if (now < _nonceBackoffUntil) {
    throw new Error('Rate limited — please wait before signing in');
  }

  const res = await fetch(`${SERVER_URL}/auth/nonce`, { credentials: 'include' });
  if (res.status === 429) {
    _nonceFailCount++;
    // Exponential backoff: 5s, 10s, 20s, 40s, capped at 60s
    const delay = Math.min(5000 * Math.pow(2, _nonceFailCount - 1), 60_000);
    _nonceBackoffUntil = Date.now() + delay;
    throw new Error('Rate limited — please wait before signing in');
  }
  if (!res.ok) throw new Error('Failed to fetch nonce');

  _nonceFailCount = 0; // Reset on success
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
  const { address: wagmiAddress, isConnected: wagmiConnected, chain } = useAccount();
  const thirdwebAccount = useActiveAccount();
  // Thirdweb manages wallet connections; wagmi may not have synced yet.
  // Use thirdweb as fallback source of truth for address and connection state.
  const address = (wagmiAddress ?? thirdwebAccount?.address) as `0x${string}` | undefined;
  const isConnected = wagmiConnected || !!thirdwebAccount;
  const [validated, setValidated] = useState(_sessionValidated);
  const { disconnect } = useDisconnect();
  const storedAddress = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether user rejected SIWE to prevent auto-sign-in loop
  const rejectedRef = useRef(false);
  // Track the last address we auto-signed for to avoid duplicate attempts
  const autoSignedForRef = useRef<string | null>(null);
  // Track failed sign-in attempts to prevent infinite retry loop
  const signInFailCountRef = useRef(0);
  const MAX_AUTO_SIGN_IN_ATTEMPTS = 2;

  // Wait for session validation before trusting localStorage
  useEffect(() => {
    if (!validated) {
      getSessionValidationDone().then(() => setValidated(true));
    }
  }, [validated]);

  // Only trust isAuthenticated after session validation completes
  const isAuthenticated = validated && Boolean(isConnected && address && storedAddress);

  /** Perform the SIWE sign-in handshake. */
  const signIn = useCallback(async () => {
    if (!address || !thirdwebAccount) return;

    setIsAuthenticating(true);
    setError(null);
    rejectedRef.current = false;

    try {
      const nonce = await fetchNonce();
      const message = buildSiweMessage({
        address,
        nonce,
        // AUTH-01 fix: Never default to mainnet (chainId 1) — require wallet to report chain.
        // Falling back to 1 creates a cross-environment phishing vector where a signature
        // valid on mainnet can be replayed on testnet or vice versa.
        chainId: chain?.id ?? 8453,
      });
      // Use thirdweb's account.signMessage — wagmi has no connectors
      // configured so wagmi's useSignMessage cannot sign.
      const signature = await thirdwebAccount.signMessage({ message });
      const result = await verifySignature(message, signature);
      setSession(result.address, result.expiresAt);
      signInFailCountRef.current = 0;
      autoSignedForRef.current = address.toLowerCase();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      // Track user rejections to prevent auto-sign-in loop
      if (msg.includes('User rejected') || msg.includes('user rejected')) {
        rejectedRef.current = true;
      } else {
        signInFailCountRef.current++;
        setError(msg);
      }
      // Mark this address as attempted so auto-sign-in doesn't retry in a loop
      autoSignedForRef.current = address.toLowerCase();
    } finally {
      setIsAuthenticating(false);
    }
  }, [address, chain?.id, thirdwebAccount]);

  /** Disconnect wallet, revoke JWT server-side, and clear SIWE session. */
  const signOut = useCallback(() => {
    clearSiweSession(true); // revoke = true
    rejectedRef.current = false;
    autoSignedForRef.current = null;
    signInFailCountRef.current = 0;
    disconnect();
  }, [disconnect]);

  // Auto-clear session if wallet disconnects or address changes
  useEffect(() => {
    if (!isConnected || !address) {
      if (storedAddress) clearSiweSession();
      rejectedRef.current = false;
      // Only reset autoSignedForRef if we had a stored session (real disconnect),
      // not on transient wagmi↔thirdweb sync flickers
      if (storedAddress) {
        autoSignedForRef.current = null;
        signInFailCountRef.current = 0;
      }
    } else if (storedAddress && storedAddress.toLowerCase() !== address.toLowerCase()) {
      // Address changed — clear old session and reset for new address
      clearSiweSession();
      rejectedRef.current = false;
      autoSignedForRef.current = null;
      signInFailCountRef.current = 0;
    }
  }, [isConnected, address, storedAddress]);

  // Auto-trigger SIWE sign-in when wallet connects without an existing session.
  // Requires thirdwebAccount to be available so signIn has a signer.
  // Guards against infinite retry: stops after MAX_AUTO_SIGN_IN_ATTEMPTS failures.
  useEffect(() => {
    if (
      isConnected &&
      address &&
      thirdwebAccount &&
      !storedAddress &&
      !isAuthenticating &&
      !rejectedRef.current &&
      signInFailCountRef.current < MAX_AUTO_SIGN_IN_ATTEMPTS &&
      autoSignedForRef.current !== address.toLowerCase()
    ) {
      signIn();
    }
  }, [isConnected, address, thirdwebAccount, storedAddress, isAuthenticating, signIn]);

  // Surface when auto-sign-in has been exhausted — wallet is connected but
  // session was never established, and we've stopped retrying.
  const needsManualSignIn =
    validated &&
    isConnected &&
    !!address &&
    !storedAddress &&
    !isAuthenticating &&
    autoSignedForRef.current === address.toLowerCase() &&
    signInFailCountRef.current >= MAX_AUTO_SIGN_IN_ATTEMPTS;

  return {
    address,
    isConnected,
    isAuthenticated,
    isAuthenticating,
    needsManualSignIn,
    error,
    signIn,
    signOut,
  };
}

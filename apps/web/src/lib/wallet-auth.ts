/**
 * Wallet-based authentication — Circle Developer Controlled Wallets + SIWE fallback.
 *
 * Circle DCW flow:
 *   email/social login → server creates Circle wallet → JWT session cookie
 *
 * Legacy SIWE flow (kept for backward compat with external wallets):
 *   connect wallet → fetch nonce → sign SIWE message → server sets cookie
 *
 * Session tokens are stored in httpOnly cookies (set by the server).
 * The client only stores the wallet address and session expiry for UI purposes.
 */
import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';

const ADDRESS_KEY = 'siwe-address';
const EXPIRY_KEY = 'siwe-expiry';
const EMAIL_KEY = 'circle-email';
const WALLET_ID_KEY = 'circle-wallet-id';
const AUTH_PROVIDER_KEY = 'auth-provider'; // 'circle' | 'siwe'

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

function setSession(address: string, expiresAt: number, email?: string, walletId?: string) {
  localStorage.setItem(ADDRESS_KEY, address);
  localStorage.setItem(EXPIRY_KEY, String(expiresAt));
  if (email) localStorage.setItem(EMAIL_KEY, email);
  if (walletId) localStorage.setItem(WALLET_ID_KEY, walletId);
  emitChange();
  // Stitch pre-login anonymous analytics to this wallet. Fire-and-forget.
  void import('./analytics').then(({ identifyUser, track }) => {
    void identifyUser(address);
    void track('auth:login_succeeded', {
      wallet: address.toLowerCase(),
      provider: getAuthProvider(),
    });
  });
}

/** Get the current auth provider type. */
export function getAuthProvider(): 'circle' | 'siwe' | null {
  return localStorage.getItem(AUTH_PROVIDER_KEY) as 'circle' | 'siwe' | null;
}

/** Get the authenticated user's email (Circle auth only). */
export function getAuthEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY);
}

/** Clear the SIWE/Circle session from local state and optionally revoke server-side. */
export function clearSiweSession(revoke = false) {
  localStorage.removeItem(ADDRESS_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem(WALLET_ID_KEY);
  localStorage.removeItem(AUTH_PROVIDER_KEY);
  emitChange();

  // Un-link the user in analytics so subsequent events are anonymous again.
  void import('./analytics').then(({ resetUser, track }) => {
    void track('auth:logout', { manual: revoke });
    void resetUser();
  });

  // Fire-and-forget server-side revocation (clears httpOnly cookie)
  if (revoke) {
    fetch(`${SERVER_URL}/auth/revoke`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {}); // Best-effort
  }
}

export type RefreshResult = 'refreshed' | 'expired' | 'network_error';

/**
 * Refresh the session cookie.
 * - 'refreshed': success, new expiry stored.
 * - 'expired': server rejected the cookie — caller should clear local state.
 * - 'network_error': server unreachable / 5xx — caller should keep the session
 *   (a transient failure must not log the user out).
 */
export async function refreshSession(): Promise<RefreshResult> {
  if (!hasSession()) return 'expired';

  try {
    const res = await fetch(`${SERVER_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.status === 401 || res.status === 403) return 'expired';
    if (!res.ok) return 'network_error';
    const data = await res.json();
    if (data.ok && data.expiresAt) {
      localStorage.setItem(EXPIRY_KEY, String(data.expiresAt));
      emitChange();
      return 'refreshed';
    }
    return 'expired';
  } catch {
    return 'network_error';
  }
}

// ── Session validation (startup) ────────────────────────────────

let _sessionValidated = false;
const _validationPromise = validateSessionOnStartup();

async function validateSessionOnStartup() {
  if (!hasSession()) {
    _sessionValidated = true;
    return;
  }

  try {
    const res = await fetch(`${SERVER_URL}/auth/me`, {
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      if (!data.authenticated) {
        clearSiweSession();
      }
    }
  } catch {
    // Network failure — keep the session (don't log out on transient errors)
  }
  _sessionValidated = true;
}

function getSessionValidationDone(): Promise<void> {
  return _validationPromise;
}

// ── Session refresh timer ───────────────────────────────────────

const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
let _refreshTimer: ReturnType<typeof setInterval> | null = null;

function startRefreshTimer() {
  if (_refreshTimer) return;
  _refreshTimer = setInterval(async () => {
    if (!hasSession()) return;
    const result = await refreshSession();
    if (result === 'expired') {
      clearSiweSession();
    }
  }, REFRESH_INTERVAL);
}

startRefreshTimer();

// ── Circle Auth API ─────────────────────────────────────────────

/**
 * Request an OTP code for email login.
 */
export async function requestEmailOTP(email: string): Promise<{ ok: boolean; _devOtp?: string }> {
  const res = await fetch(`${SERVER_URL}/auth/circle/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(data.error || 'Failed to send verification code');
  }

  return res.json();
}

/**
 * Verify an OTP code and establish a session.
 */
export async function verifyEmailOTP(
  email: string,
  code: string
): Promise<{ address: string; email: string; walletId: string; expiresAt: number }> {
  const res = await fetch(`${SERVER_URL}/auth/circle/verify-otp`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Verification failed' }));
    throw new Error(data.error || 'Invalid verification code');
  }

  const result = await res.json();
  localStorage.setItem(AUTH_PROVIDER_KEY, 'circle');
  setSession(result.address, result.expiresAt, result.email, result.walletId);
  return result;
}

/**
 * Social login (Google/Apple) — send the verified email from OAuth.
 */
export async function socialLogin(
  email: string,
  provider: 'google' | 'apple',
  idToken?: string
): Promise<{ address: string; email: string; walletId: string; expiresAt: number }> {
  const res = await fetch(`${SERVER_URL}/auth/circle/social`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, provider, idToken }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Social login failed' }));
    throw new Error(data.error || 'Social login failed');
  }

  const result = await res.json();
  localStorage.setItem(AUTH_PROVIDER_KEY, 'circle');
  setSession(result.address, result.expiresAt, result.email, result.walletId);
  return result;
}

// ── React Hook ──────────────────────────────────────────────────

/**
 * Primary authentication hook.
 *
 * Supports both Circle (email/social) and legacy SIWE (wallet signature) flows.
 * The returned shape is backward-compatible — all downstream consumers
 * (protected routes, tRPC auth, etc.) work unchanged.
 */
export function useWalletAuth() {
  const [validated, setValidated] = useState(_sessionValidated);
  const storedAddress = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wait for session validation before trusting localStorage
  useEffect(() => {
    if (!validated) {
      getSessionValidationDone().then(() => setValidated(true));
    }
  }, [validated]);

  // Circle auth: address comes from localStorage (set during login)
  // There's no wallet "connection" in the thirdweb sense — the wallet
  // is server-managed. isConnected is true whenever we have a session.
  const address = storedAddress as `0x${string}` | undefined;
  const isConnected = validated && !!storedAddress;
  const isAuthenticated = validated && !!storedAddress;

  /** Sign in with email OTP (Circle flow). */
  const signInWithEmail = useCallback(async (email: string, code: string) => {
    setIsAuthenticating(true);
    setError(null);
    try {
      await verifyEmailOTP(email, code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  /** Sign in with social provider (Circle flow). */
  const signInWithSocial = useCallback(
    async (email: string, provider: 'google' | 'apple', idToken?: string) => {
      setIsAuthenticating(true);
      setError(null);
      try {
        await socialLogin(email, provider, idToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sign-in failed');
        throw err;
      } finally {
        setIsAuthenticating(false);
      }
    },
    []
  );

  /** Sign out — clear session and revoke server-side. */
  const signOut = useCallback(() => {
    clearSiweSession(true);
  }, []);

  /** Legacy SIWE sign-in (no-op placeholder — kept for API compat). */
  const signIn = useCallback(async () => {
    // SIWE wallet-based sign-in is deprecated.
    // Use signInWithEmail or signInWithSocial instead.
    console.warn('[auth] Legacy SIWE signIn called — use signInWithEmail or signInWithSocial');
  }, []);

  return {
    address,
    isConnected,
    isAuthenticated,
    isAuthenticating,
    needsManualSignIn: false,
    error,
    signIn,
    signInWithEmail,
    signInWithSocial,
    signOut,
  };
}

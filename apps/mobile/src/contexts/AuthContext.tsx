/**
 * Auth context for the mobile app — Circle DCW only.
 *
 * Mirrors `apps/web/src/lib/wallet-auth.ts`:
 *   1. `requestEmailOTP(email)` — server emails a 6-digit code
 *   2. `signInWithEmail(email, code)` — verify code, receive JWT + wallet
 *   3. `signInWithGoogle(idToken)` — native Google sign-in path
 *
 * The JWT is stored in expo-secure-store. On app launch we restore the
 * session if the token is still within its stored expiry.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  requestEmailOTP as apiRequestEmailOTP,
  socialLogin,
  verifyEmailOTP,
  type CircleAuthResult,
} from '../lib/circle-auth';
import { clearSession, getStoredSession, setSession } from '../lib/storage';

interface AuthState {
  address: string | null;
  token: string | null;
  email: string | null;
  expiresAt: number | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  requestEmailOTP: (
    email: string
  ) => Promise<{ ok: boolean; throttled?: boolean; _devOtp?: string }>;
  signInWithEmail: (email: string, code: string) => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    address: null,
    token: null,
    email: null,
    expiresAt: null,
    isAuthenticated: false,
    isAuthenticating: false,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    (async () => {
      const session = await getStoredSession();
      if (session) {
        setState((s) => ({
          ...s,
          token: session.token,
          address: session.address,
          email: session.email,
          expiresAt: session.expiresAt,
          isAuthenticated: true,
          isLoading: false,
        }));
      } else {
        // Drop any stale fragments from an older install (e.g. thirdweb token).
        await clearSession().catch(() => undefined);
        setState((s) => ({ ...s, isLoading: false }));
      }
    })();
  }, []);

  const persist = useCallback(async (result: CircleAuthResult) => {
    await setSession({
      token: result.token,
      address: result.address,
      email: result.email,
      expiresAt: result.expiresAt,
    });
    setState((s) => ({
      ...s,
      token: result.token,
      address: result.address,
      email: result.email,
      expiresAt: result.expiresAt,
      isAuthenticated: true,
      isAuthenticating: false,
      error: null,
    }));
  }, []);

  const runAuth = useCallback(
    async (fn: () => Promise<CircleAuthResult>) => {
      setState((s) => ({ ...s, isAuthenticating: true, error: null }));
      try {
        const result = await fn();
        await persist(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sign-in failed';
        setState((s) => ({ ...s, isAuthenticating: false, error: msg }));
        throw err;
      }
    },
    [persist]
  );

  const requestEmailOTP = useCallback((email: string) => apiRequestEmailOTP(email), []);

  const signInWithEmail = useCallback(
    (email: string, code: string) => runAuth(() => verifyEmailOTP(email, code)),
    [runAuth]
  );

  const signInWithGoogle = useCallback(
    (idToken: string) => runAuth(() => socialLogin('google', idToken)),
    [runAuth]
  );

  const signOut = useCallback(async () => {
    await clearSession();
    setState({
      address: null,
      token: null,
      email: null,
      expiresAt: null,
      isAuthenticated: false,
      isAuthenticating: false,
      isLoading: false,
      error: null,
    });
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        requestEmailOTP,
        signInWithEmail,
        signInWithGoogle,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

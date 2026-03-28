/**
 * Auth context for the mobile app.
 *
 * Manages:
 *  - wallet connection state via Reown AppKit
 *  - SIWE sign-in / sign-out
 *  - JWT storage in expo-secure-store
 *  - silent reconnect on app resume
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { clearSession, getStoredAddress, getToken, setSession } from '../lib/storage';
import { buildSiweMessage, fetchNonce, verifySignature } from '../lib/siwe';

// ── Types ──────────────────────────────────────────────────────────────

interface AuthState {
  address: string | null;
  token: string | null;
  isConnected: boolean;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  /** Connect wallet and sign SIWE message to get JWT. */
  signIn: (address: string, signMessage: (msg: string) => Promise<string>, chainId?: number) => Promise<void>;
  /** Clear session and disconnect. */
  signOut: () => Promise<void>;
  /** Clear any auth error. */
  clearError: () => void;
}

// ── Context ────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    address: null,
    token: null,
    isConnected: false,
    isAuthenticated: false,
    isAuthenticating: false,
    isLoading: true,
    error: null,
  });

  // Restore session on mount
  useEffect(() => {
    (async () => {
      const [token, address] = await Promise.all([getToken(), getStoredAddress()]);
      if (token && address) {
        setState((s) => ({
          ...s,
          token,
          address,
          isConnected: true,
          isAuthenticated: true,
          isLoading: false,
        }));
      } else {
        setState((s) => ({ ...s, isLoading: false }));
      }
    })();
  }, []);

  const signIn = useCallback(
    async (
      address: string,
      signMessage: (msg: string) => Promise<string>,
      chainId = 11155111 // Sepolia
    ) => {
      setState((s) => ({ ...s, isAuthenticating: true, error: null }));
      try {
        const nonce = await fetchNonce();
        const message = buildSiweMessage({ address, nonce, chainId });
        const signature = await signMessage(message);
        const result = await verifySignature(message, signature);
        await setSession(result.token, result.address);
        setState((s) => ({
          ...s,
          address: result.address,
          token: result.token,
          isConnected: true,
          isAuthenticated: true,
          isAuthenticating: false,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sign-in failed';
        const isRejection = msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel');
        setState((s) => ({
          ...s,
          isAuthenticating: false,
          error: isRejection ? null : msg,
        }));
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    await clearSession();
    setState({
      address: null,
      token: null,
      isConnected: false,
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
    <AuthContext.Provider value={{ ...state, signIn, signOut, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

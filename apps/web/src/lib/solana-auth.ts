/**
 * Solana wallet authentication using SIWS (Sign-In With Solana).
 *
 * Parallel to wallet-auth.ts (SIWE for EVM). Both produce the same JWT
 * format — the server doesn't care which chain the user authenticated from.
 *
 * Flow: connect Solana wallet → fetch nonce → sign SIWS message → verify → store JWT
 */
import { useState, useCallback, useSyncExternalStore } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

const TOKEN_KEY = 'siwe-token'; // shared key — same session store as EVM
const ADDRESS_KEY = 'siwe-address';
const CHAIN_KEY = 'auth-chain'; // 'evm' | 'solana'

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

export function getSolanaToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setSession(token: string, address: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ADDRESS_KEY, address);
  localStorage.setItem(CHAIN_KEY, 'solana');
  emitChange();
}

export function clearSolanaSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADDRESS_KEY);
  localStorage.removeItem(CHAIN_KEY);
  emitChange();
}

/** Get which chain family the current session authenticated with. */
export function getAuthChain(): 'evm' | 'solana' | 'sui' | null {
  return localStorage.getItem(CHAIN_KEY) as 'evm' | 'solana' | 'sui' | null;
}

// ── SIWS message construction ──────────────────────────────────

function buildSiwsMessage(params: { address: string; nonce: string }) {
  const domain = window.location.host;
  const uri = window.location.origin;
  const now = new Date().toISOString();

  return [
    `${domain} wants you to sign in with your Solana account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: solana`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now}`,
  ].join('\n');
}

// ── SIWS handshake ─────────────────────────────────────────────

async function fetchNonce(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!res.ok) throw new Error('Failed to fetch nonce');
  const data = await res.json();
  return data.nonce;
}

async function verifySignature(
  message: string,
  signature: string,
  publicKey: string
): Promise<{ token: string; address: string }> {
  const res = await fetch(`${SERVER_URL}/auth/verify-solana`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature, publicKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Verification failed' }));
    throw new Error(err.error || 'Verification failed');
  }
  return res.json();
}

// ── React hook ─────────────────────────────────────────────────

export function useSolanaAuth() {
  const { publicKey, signMessage, disconnect, connected } = useWallet();
  const token = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = publicKey?.toBase58() ?? null;
  const isAuthenticated = Boolean(connected && publicKey && token && getAuthChain() === 'solana');

  /** Perform the SIWS sign-in handshake. */
  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) return;

    setIsAuthenticating(true);
    setError(null);

    try {
      const nonce = await fetchNonce();
      const message = buildSiwsMessage({
        address: publicKey.toBase58(),
        nonce,
      });

      const encodedMessage = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(encodedMessage);
      const signature = bs58.encode(signatureBytes);

      const result = await verifySignature(message, signature, publicKey.toBase58());
      setSession(result.token, result.address);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      if (!msg.includes('User rejected') && !msg.includes('user rejected')) {
        setError(msg);
      }
    } finally {
      setIsAuthenticating(false);
    }
  }, [publicKey, signMessage]);

  /** Disconnect wallet and clear session. */
  const signOut = useCallback(() => {
    clearSolanaSession();
    disconnect();
  }, [disconnect]);

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

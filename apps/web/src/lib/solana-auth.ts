/**
 * Solana sign-in hook.
 *
 * Mirrors useWalletAuth (EVM/Circle) for the Phantom/Solflare/Backpack path:
 *   1. GET /auth/nonce       (shared with SIWE)
 *   2. wallet.signMessage(...) to produce ed25519 sig
 *   3. POST /auth/solana/verify { message, signature }  → httpOnly cookie
 *   4. Local state stores address + chainNamespace='solana'
 *
 * For users already authenticated via EVM, see `linkSolanaWallet` which
 * keeps the EVM primary identity and appends `sol` to the JWT.
 */
import { useCallback, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { SOLANA_CLUSTER } from './solana-provider';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

const SOLANA_ADDRESS_KEY = 'loar.solanaAddress';
const SOLANA_EXPIRY_KEY = 'loar.solanaExpiresAt';

const SOLANA_GENESIS = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc7UMKUbpZF',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
} as const;

function buildMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  cluster: 'devnet' | 'mainnet-beta' | 'testnet';
}): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  const chainRef = `solana:${SOLANA_GENESIS[params.cluster].slice(0, 32)}`;
  return [
    `${params.domain} wants you to sign in with your Solana account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${params.uri}`,
    `Version: 1`,
    `Chain ID: ${chainRef}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function fetchNonce(): Promise<string> {
  const resp = await fetch(`${SERVER_URL}/auth/nonce`, { credentials: 'include' });
  if (!resp.ok) throw new Error('Failed to fetch nonce');
  const json = (await resp.json()) as { nonce: string };
  return json.nonce;
}

export interface SolanaAuthState {
  address: string | null;
  isAuthenticated: boolean;
  isSigningIn: boolean;
  error: string | null;
}

export function useSolanaAuth() {
  const wallet = useWallet();
  const [state, setState] = useState<SolanaAuthState>(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(SOLANA_ADDRESS_KEY) : null;
    const expiryRaw =
      typeof window !== 'undefined' ? localStorage.getItem(SOLANA_EXPIRY_KEY) : null;
    const expiry = expiryRaw ? Number(expiryRaw) : 0;
    const valid = stored !== null && expiry > Date.now();
    return {
      address: valid ? stored : null,
      isAuthenticated: valid,
      isSigningIn: false,
      error: null,
    };
  });

  const signIn = useCallback(async (): Promise<{ address: string } | null> => {
    if (!wallet.connected || !wallet.publicKey || !wallet.signMessage) {
      setState((s) => ({ ...s, error: 'Wallet not connected' }));
      return null;
    }

    setState((s) => ({ ...s, isSigningIn: true, error: null }));
    try {
      const nonce = await fetchNonce();
      const address = wallet.publicKey.toBase58();
      const message = buildMessage({
        domain: window.location.host,
        address,
        uri: window.location.origin,
        nonce,
        cluster: SOLANA_CLUSTER,
      });

      const encoded = new TextEncoder().encode(message);
      const sigBytes = await wallet.signMessage(encoded);
      const signature = bs58.encode(sigBytes);

      const resp = await fetch(`${SERVER_URL}/auth/solana/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Verification failed' }));
        throw new Error(err.error ?? 'Verification failed');
      }
      const result = (await resp.json()) as { address: string; expiresAt: number };

      localStorage.setItem(SOLANA_ADDRESS_KEY, result.address);
      localStorage.setItem(SOLANA_EXPIRY_KEY, String(result.expiresAt));
      setState({
        address: result.address,
        isAuthenticated: true,
        isSigningIn: false,
        error: null,
      });
      return { address: result.address };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed';
      setState((s) => ({ ...s, isSigningIn: false, error: message }));
      return null;
    }
  }, [wallet]);

  const linkToEvmSession = useCallback(async (): Promise<{ solanaAddress: string } | null> => {
    if (!wallet.connected || !wallet.publicKey || !wallet.signMessage) {
      setState((s) => ({ ...s, error: 'Wallet not connected' }));
      return null;
    }
    setState((s) => ({ ...s, isSigningIn: true, error: null }));
    try {
      const nonce = await fetchNonce();
      const address = wallet.publicKey.toBase58();
      const message = buildMessage({
        domain: window.location.host,
        address,
        uri: window.location.origin,
        nonce,
        cluster: SOLANA_CLUSTER,
      });
      const encoded = new TextEncoder().encode(message);
      const sigBytes = await wallet.signMessage(encoded);
      const signature = bs58.encode(sigBytes);

      const resp = await fetch(`${SERVER_URL}/auth/solana/link`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Link failed' }));
        throw new Error(err.error ?? 'Link failed');
      }
      const result = (await resp.json()) as { solanaAddress: string };

      localStorage.setItem(SOLANA_ADDRESS_KEY, result.solanaAddress);
      setState((s) => ({ ...s, address: result.solanaAddress, isSigningIn: false }));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Link failed';
      setState((s) => ({ ...s, isSigningIn: false, error: message }));
      return null;
    }
  }, [wallet]);

  const signOut = useCallback(async () => {
    localStorage.removeItem(SOLANA_ADDRESS_KEY);
    localStorage.removeItem(SOLANA_EXPIRY_KEY);
    setState({ address: null, isAuthenticated: false, isSigningIn: false, error: null });
    try {
      await wallet.disconnect();
    } catch {
      // wallet not connected — ignore
    }
  }, [wallet]);

  return {
    ...state,
    wallet,
    signIn,
    linkToEvmSession,
    signOut,
  };
}

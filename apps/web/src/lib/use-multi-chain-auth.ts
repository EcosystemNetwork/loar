/**
 * Unified multi-chain auth hook.
 *
 * Abstracts over EVM (SIWE), Solana (SIWS), and SUI auth so components
 * don't need to know which chain the user connected with.
 *
 * Priority: if the user has an active EVM session, use that.
 * If they have a Solana session, use that. Components just see
 * `isAuthenticated`, `address`, `signIn`, `signOut`.
 */

import { useWalletAuth } from './wallet-auth';
import { useSolanaAuth, getAuthChain } from './solana-auth';
import { useSuiAuth } from './sui-auth';

export type ChainFamily = 'evm' | 'solana' | 'sui';

export interface MultiChainAuth {
  /** The active chain family, or null if not authenticated. */
  chainFamily: ChainFamily | null;
  /** Wallet address (hex for EVM, base58 for Solana). */
  address: string | null | undefined;
  /** Whether any wallet is connected (not necessarily authenticated). */
  isConnected: boolean;
  /** Whether a valid session exists. */
  isAuthenticated: boolean;
  /** Whether a sign-in is in progress. */
  isAuthenticating: boolean;
  /** Last auth error message. */
  error: string | null;
  /** Trigger sign-in for the active wallet. */
  signIn: () => Promise<void>;
  /** Disconnect and clear session. */
  signOut: () => void;
  /** Raw EVM auth hook (for EVM-specific operations). */
  evm: ReturnType<typeof useWalletAuth>;
  /** Raw Solana auth hook (for Solana-specific operations). */
  solana: ReturnType<typeof useSolanaAuth>;
  /** Raw SUI auth hook (for SUI-specific operations). */
  sui: ReturnType<typeof useSuiAuth>;
}

export function useMultiChainAuth(): MultiChainAuth {
  const evm = useWalletAuth();
  const solana = useSolanaAuth();
  const sui = useSuiAuth();

  const authChain = getAuthChain();

  // Determine active chain: authenticated session takes priority,
  // then connected wallet, then null.
  let chainFamily: ChainFamily | null = null;
  let address: string | null | undefined = null;
  let isConnected = false;
  let isAuthenticated = false;
  let isAuthenticating = false;
  let error: string | null = null;
  let signIn: () => Promise<void>;
  let signOut: () => void;

  if (evm.isAuthenticated || (authChain === 'evm' && evm.isConnected)) {
    chainFamily = 'evm';
    address = evm.address;
    isConnected = evm.isConnected;
    isAuthenticated = evm.isAuthenticated;
    isAuthenticating = evm.isAuthenticating;
    error = evm.error;
    signIn = evm.signIn;
    signOut = evm.signOut;
  } else if (solana.isAuthenticated || (authChain === 'solana' && solana.isConnected)) {
    chainFamily = 'solana';
    address = solana.address;
    isConnected = solana.isConnected;
    isAuthenticated = solana.isAuthenticated;
    isAuthenticating = solana.isAuthenticating;
    error = solana.error;
    signIn = solana.signIn;
    signOut = solana.signOut;
  } else if (evm.isConnected) {
    chainFamily = 'evm';
    address = evm.address;
    isConnected = true;
    signIn = evm.signIn;
    signOut = evm.signOut;
  } else if (sui.isAuthenticated || (authChain === 'sui' && sui.isConnected)) {
    chainFamily = 'sui';
    address = sui.address;
    isConnected = sui.isConnected;
    isAuthenticated = sui.isAuthenticated;
    isAuthenticating = sui.isAuthenticating;
    error = sui.error;
    signIn = sui.signIn;
    signOut = sui.signOut;
  } else if (solana.isConnected) {
    chainFamily = 'solana';
    address = solana.address;
    isConnected = true;
    signIn = solana.signIn;
    signOut = solana.signOut;
  } else if (sui.isConnected) {
    chainFamily = 'sui';
    address = sui.address;
    isConnected = true;
    signIn = sui.signIn;
    signOut = sui.signOut;
  } else {
    signIn = evm.signIn; // default to EVM
    signOut = evm.signOut;
  }

  return {
    chainFamily,
    address,
    isConnected,
    isAuthenticated,
    isAuthenticating,
    error,
    signIn,
    signOut,
    evm,
    solana,
    sui,
  };
}

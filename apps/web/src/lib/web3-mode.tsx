/**
 * Web3 Mode — Progressive Disclosure Context
 *
 * By default, the platform looks like a normal Web2 app.
 * When web3Mode is enabled, blockchain-specific UI surfaces:
 * chain badges, wallet addresses, gas costs, explorer links, etc.
 *
 * The toggle persists to Firestore (profile.web3Enabled) and
 * falls back to localStorage for unauthenticated users.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useMultiChainAuth } from './use-multi-chain-auth';

interface Web3ModeContextValue {
  /** Whether Web3 UI elements are visible */
  web3Mode: boolean;
  /** Toggle Web3 mode on/off */
  setWeb3Mode: (enabled: boolean) => void;
  /** Whether the preference is still loading */
  isLoading: boolean;
}

const Web3ModeContext = createContext<Web3ModeContextValue>({
  web3Mode: false,
  setWeb3Mode: () => {},
  isLoading: true,
});

const STORAGE_KEY = 'loar-web3-mode';

export function Web3ModeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useMultiChainAuth();
  const queryClient = useQueryClient();

  // Local fallback (localStorage)
  const [localMode, setLocalMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Fetch from profile if authenticated
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => trpcClient.profiles.me.query(),
    enabled: isAuthenticated,
  });

  // Persist to server
  const persistMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      trpcClient.profiles.setWeb3Mode.mutate({ web3Enabled: enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });

  // Derive the actual value
  const web3Mode = isAuthenticated ? ((profile as any)?.web3Enabled ?? localMode) : localMode;

  const isLoading = isAuthenticated ? profileLoading : false;

  const setWeb3Mode = useCallback(
    (enabled: boolean) => {
      // Always update localStorage as fallback
      try {
        localStorage.setItem(STORAGE_KEY, String(enabled));
      } catch {}
      setLocalMode(enabled);

      // Persist to profile if authenticated
      if (isAuthenticated) {
        persistMutation.mutate(enabled);
      }
    },
    [isAuthenticated, persistMutation]
  );

  return (
    <Web3ModeContext.Provider value={{ web3Mode, setWeb3Mode, isLoading }}>
      {children}
    </Web3ModeContext.Provider>
  );
}

export function useWeb3Mode() {
  return useContext(Web3ModeContext);
}

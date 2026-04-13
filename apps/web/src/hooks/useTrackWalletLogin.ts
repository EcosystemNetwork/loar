import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';

/**
 * Tracks wallet connections to Firebase via tRPC.
 * Fires once per authenticated session (deduped by address).
 */
export function useTrackWalletLogin() {
  const { chain, connector } = useAccount();
  const { address, isAuthenticated } = useWalletAuth();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !address || lastTracked.current === address) return;

    lastTracked.current = address;

    trpcClient.trackWalletLogin
      .mutate({
        address,
        chainId: chain?.id ?? 0,
        connector: connector?.name,
      })
      .catch(() => {
        // Server not running — silently ignore
      });
  }, [isAuthenticated, address, chain?.id, connector?.name]);
}

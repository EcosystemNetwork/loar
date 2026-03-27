import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { trpcClient } from '@/utils/trpc';

/**
 * Tracks wallet connections to Firebase via tRPC.
 * Fires once per connection (deduped by address).
 */
export function useTrackWalletLogin() {
  const { address, isConnected, chain, connector } = useAccount();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address || lastTracked.current === address) return;

    lastTracked.current = address;

    trpcClient.trackWalletLogin
      .mutate({
        address,
        chainId: chain?.id ?? 0,
        connector: connector?.name,
      })
      .catch((err: unknown) => {
        console.warn('Failed to track wallet login:', err);
      });
  }, [isConnected, address, chain?.id, connector?.name]);
}

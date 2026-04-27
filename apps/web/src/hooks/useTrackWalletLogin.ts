import { useEffect, useRef } from 'react';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { useWalletAuth, getAuthProvider } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { SUPPORTED_CHAIN_IDS } from '@/configs/chains';

/**
 * Tracks wallet connections to Firebase via tRPC.
 * Fires once per authenticated session (deduped by address).
 *
 * Circle DCW users have no wagmi connector (the wallet is server-managed),
 * so `chain`/`connector` from useAccount are always undefined for them.
 * Fall back to the auth provider name + the app's default chain so the
 * audit row carries useful values instead of `chainId: 0, connector: null`.
 */
export function useTrackWalletLogin() {
  const { chain, connector } = useAccount();
  const { address, isAuthenticated } = useWalletAuth();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !address || lastTracked.current === address) return;

    lastTracked.current = address;

    const provider = getAuthProvider();
    const chainId = chain?.id ?? SUPPORTED_CHAIN_IDS[0] ?? 0;
    const connectorName = connector?.name ?? provider ?? undefined;

    trpcClient.trackWalletLogin
      .mutate({
        address,
        chainId,
        connector: connectorName,
      })
      .catch(() => {
        // Server not running — silently ignore
      });
  }, [isAuthenticated, address, chain?.id, connector?.name]);
}

/**
 * useCircleSolanaAddress — fetch the caller's Circle DCW Solana wallet address.
 *
 * Calls GET /api/solana/wallet, which provisions a Circle-managed Solana wallet
 * tied to the user's uid on first request. No external wallet adapter required.
 */
import { useQuery } from '@tanstack/react-query';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

interface CircleSolanaWalletResponse {
  walletId: string;
  address: string;
  cluster: string;
}

export function useCircleSolanaAddress(enabled: boolean = true) {
  const query = useQuery({
    queryKey: ['circle-solana-wallet'],
    queryFn: async (): Promise<CircleSolanaWalletResponse | null> => {
      const resp = await fetch(`${SERVER_URL}/api/solana/wallet`, { credentials: 'include' });
      if (!resp.ok) return null;
      return (await resp.json()) as CircleSolanaWalletResponse;
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  return {
    address: query.data?.address ?? null,
    walletId: query.data?.walletId ?? null,
    cluster: query.data?.cluster ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

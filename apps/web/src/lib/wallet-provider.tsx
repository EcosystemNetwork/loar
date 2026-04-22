/**
 * Wallet Provider — Minimal auth context wrapper
 *
 * Previously wrapped ThirdwebProvider + WagmiProvider.
 * Now provides a lightweight context for Circle DCW auth state.
 * wagmi stays for read-only contract calls (useReadContract, useChainId).
 */
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/../config';
import type { ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't refetch on window focus — prevents auth/contract data thrashing
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * Multi-Chain Provider
 *
 * Wraps the app in EVM (wagmi), Solana, and SUI wallet providers.
 * Components below this can use any chain family's hooks.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletWrapper } from './wallet-provider';
import { SolanaProvider } from './solana-provider';
import { SuiProvider } from './sui-provider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

interface MultiChainProviderProps {
  children: React.ReactNode;
}

export function MultiChainProvider({ children }: MultiChainProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletWrapper>
        <SolanaProvider>
          <SuiProvider>{children}</SuiProvider>
        </SolanaProvider>
      </WalletWrapper>
    </QueryClientProvider>
  );
}

/**
 * Wallet Provider Wrapper
 *
 * Uses thirdweb for wallet connection + wagmi for contract hooks.
 * ThirdwebProvider handles wallet UI and connection state.
 * Wagmi hooks (useAccount, useSignMessage, etc.) work via thirdweb's built-in wagmi support.
 */

import { ThirdwebProvider } from 'thirdweb/react';
import { WagmiProvider } from 'wagmi';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { config } from '../../config';

interface WalletProviderProps {
  children: React.ReactNode;
  queryClient: QueryClient;
}

/**
 * Top-level wallet context provider.
 *
 * Nesting order (outermost → innermost):
 *   ThirdwebProvider → WagmiProvider → QueryClientProvider
 */
export function WalletWrapper({ children, queryClient }: WalletProviderProps) {
  return (
    <ThirdwebProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </ThirdwebProvider>
  );
}

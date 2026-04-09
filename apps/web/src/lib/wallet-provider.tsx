/**
 * Wallet Provider Wrapper
 *
 * Uses Dynamic Labs for EVM wallet connection (Sepolia).
 * DynamicWagmiConnector bridges Dynamic's wallet state into wagmi hooks
 * so existing useAccount / useSignMessage / etc. calls keep working.
 */

import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { DynamicWagmiConnector } from '@dynamic-labs/wagmi-connector';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
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
 *   DynamicContextProvider → WagmiProvider → QueryClientProvider → DynamicWagmiConnector
 *
 * Uses the shared queryClient from the app to avoid duplicate cache instances.
 */
export function WalletWrapper({ children, queryClient }: WalletProviderProps) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID || '',
        walletConnectors: [EthereumWalletConnectors],
      }}
    >
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <DynamicWagmiConnector>{children as React.ReactNode}</DynamicWagmiConnector>
        </QueryClientProvider>
      </WagmiProvider>
    </DynamicContextProvider>
  );
}

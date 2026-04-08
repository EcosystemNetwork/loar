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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '../../config';

const dynamicQueryClient = new QueryClient();

interface WalletProviderProps {
  children: React.ReactNode;
}

/**
 * Top-level wallet context provider.
 *
 * Nesting order (outermost → innermost):
 *   DynamicContextProvider → WagmiProvider → QueryClientProvider → DynamicWagmiConnector
 */
export function WalletWrapper({ children }: WalletProviderProps) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID || '',
        walletConnectors: [EthereumWalletConnectors],
      }}
    >
      <WagmiProvider config={config}>
        <QueryClientProvider client={dynamicQueryClient}>
          <DynamicWagmiConnector>{children}</DynamicWagmiConnector>
        </QueryClientProvider>
      </WagmiProvider>
    </DynamicContextProvider>
  );
}

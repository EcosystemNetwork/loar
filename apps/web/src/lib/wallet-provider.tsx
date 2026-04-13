/**
 * Wallet Provider Wrapper
 *
 * Uses Dynamic Labs for EVM wallet connection.
 * DynamicWagmiConnector bridges Dynamic's wallet state into wagmi hooks
 * so existing useAccount / useSignMessage / etc. calls keep working.
 */

import { useCallback } from 'react';
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { DynamicWagmiConnector } from '@dynamic-labs/wagmi-connector';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import { WagmiProvider } from 'wagmi';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { config } from '../../config';
import { SUPPORTED_EVM_CHAIN_IDS } from '../configs/chains';

const supportedSet = new Set<number>(SUPPORTED_EVM_CHAIN_IDS as unknown as number[]);

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
  // Filter Dynamic's dashboard networks to only chains we support.
  // Must be stable ref (useCallback) since Dynamic uses it in a dep array.
  const filterNetworks = useCallback(
    (dashboardNetworks: any[]) =>
      dashboardNetworks.filter((n) => supportedSet.has(Number(n.chainId))),
    []
  );

  return (
    <DynamicContextProvider
      settings={{
        environmentId: import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID || '',
        walletConnectors: [EthereumWalletConnectors],
        initialAuthenticationMode: 'connect-only',
        overrides: {
          evmNetworks: filterNetworks,
        },
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

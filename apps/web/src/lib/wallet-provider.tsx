/**
 * Wallet Provider — Minimal auth context wrapper
 *
 * Provides a lightweight context for Circle DCW auth state. wagmi stays
 * for read-only contract calls (useReadContract, useChainId).
 *
 * The QueryClient is owned by utils/trpc.ts — we accept it as a prop so the
 * tRPC react-query hooks share the same client as everything else in the tree.
 */
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/../config';
import type { ReactNode } from 'react';

export function WalletProvider({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * SUI Wallet Provider
 *
 * Wraps the app in SUI dapp-kit context alongside the existing
 * wagmi/EVM and Solana providers. Supports Sui Wallet, Suiet, and other SUI wallets.
 */

import { getFullnodeUrl } from '@mysten/sui/client';
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit';

import '@mysten/dapp-kit/dist/index.css';

type SuiNetwork = 'mainnet' | 'testnet' | 'devnet';

const SUI_NETWORK: SuiNetwork = (import.meta.env.VITE_SUI_NETWORK as SuiNetwork) || 'testnet';

const { networkConfig } = createNetworkConfig({
  mainnet: { url: import.meta.env.VITE_SUI_RPC_URL || getFullnodeUrl('mainnet') },
  testnet: { url: import.meta.env.VITE_SUI_RPC_URL || getFullnodeUrl('testnet') },
  devnet: { url: import.meta.env.VITE_SUI_RPC_URL || getFullnodeUrl('devnet') },
});

interface SuiProviderProps {
  children: React.ReactNode;
}

export function SuiProvider({ children }: SuiProviderProps) {
  return (
    <SuiClientProvider networks={networkConfig} defaultNetwork={SUI_NETWORK}>
      <WalletProvider autoConnect>{children}</WalletProvider>
    </SuiClientProvider>
  );
}

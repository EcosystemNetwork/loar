/**
 * Wallet Provider Wrapper
 *
 * Wraps the application in WagmiProvider, supplying the shared wagmi config
 * (chains, connectors, transports) to all descendant hooks and components.
 */

import { WagmiProvider } from 'wagmi';
import { config } from '../../config';

interface WalletProviderProps {
  children: React.ReactNode;
}

/**
 * Top-level wallet context provider.
 * @param props.children - React children to render within the wagmi context
 */
export function WalletWrapper({ children }: WalletProviderProps) {
  return <WagmiProvider config={config}>{children}</WagmiProvider>;
}

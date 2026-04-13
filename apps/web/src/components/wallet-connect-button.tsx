/**
 * Wallet Connect Button
 *
 * Renders thirdweb's ConnectButton for multi-chain wallet connection.
 * Uses inline modal (connectModal.size: "compact") and redirect auth mode
 * to avoid browser popup blockers.
 * After wallet connection, the existing SIWE auth flow triggers automatically
 * via useWalletAuth (unchanged).
 */

import { useMemo } from 'react';
import { ConnectButton } from 'thirdweb/react';
import { createWallet, inAppWallet } from 'thirdweb/wallets';
import { thirdwebClient } from '@/lib/thirdweb';
import { sepolia, baseSepolia, base } from 'thirdweb/chains';

const supportedChains = [sepolia, baseSepolia, base];

interface WalletConnectButtonProps {
  size?: 'sm' | 'lg';
  className?: string;
}

export const WalletConnectButton: React.FC<WalletConnectButtonProps> = ({ className = '' }) => {
  // Lazily create wallet instances inside the component so they aren't
  // instantiated at module-load time. Top-level createWallet() calls
  // trigger connector initialisation (WalletConnect relays, injected
  // provider probes) which browsers flag as popup attempts.
  const wallets = useMemo(
    () => [
      inAppWallet({
        auth: {
          options: ['email', 'google', 'apple', 'phone', 'passkey'],
          mode: 'redirect',
        },
      }),
      createWallet('io.metamask'),
      createWallet('com.coinbase.wallet'),
      createWallet('me.rainbow'),
      createWallet('io.rabby'),
    ],
    []
  );

  return (
    <div className={className}>
      <ConnectButton
        client={thirdwebClient}
        chains={supportedChains}
        wallets={wallets}
        theme="dark"
        connectModal={{ size: 'compact' }}
      />
    </div>
  );
};

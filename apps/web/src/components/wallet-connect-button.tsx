/**
 * Wallet Connect Button
 *
 * Renders thirdweb's ConnectButton for multi-chain wallet connection.
 * Uses inline modal (connectModal.size: "compact") and redirect auth mode
 * to avoid browser popup blockers.
 *
 * ENS resolution is disabled — the app runs on Base/Sepolia, not mainnet,
 * so ENS lookups fail and spam the console. Custom account name/avatar
 * overrides prevent thirdweb from attempting ENS/social resolution.
 */

import { useMemo } from 'react';
import { ConnectButton } from 'thirdweb/react';
import { createWallet, inAppWallet } from 'thirdweb/wallets';
import { useAccount } from 'wagmi';
import { thirdwebClient } from '@/lib/thirdweb';
import { sepolia, baseSepolia, base } from 'thirdweb/chains';

const supportedChains = [sepolia, baseSepolia, base];

/** Truncate address for display: 0x1234...abcd */
function shortAddr(addr?: string) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

interface WalletConnectButtonProps {
  size?: 'sm' | 'lg';
  className?: string;
}

export const WalletConnectButton: React.FC<WalletConnectButtonProps> = ({ className = '' }) => {
  const { address } = useAccount();

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
        // Disable ENS resolution by providing explicit name/avatar overrides.
        // Without these, thirdweb tries to resolve ENS on mainnet which fails
        // on Sepolia/Base and spams "Failed to resolve" console errors.
        detailsButton={{
          connectedAccountName: shortAddr(address),
          connectedAccountAvatarUrl: undefined,
        }}
        detailsModal={{
          connectedAccountName: shortAddr(address),
          connectedAccountAvatarUrl: undefined,
        }}
      />
    </div>
  );
};

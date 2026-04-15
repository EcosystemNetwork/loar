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
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { thirdwebClient } from '@/lib/thirdweb';
import { useUnstoppableDomain, formatDisplayName } from '@/hooks/useUnstoppableDomain';
import { SUPPORTED_CHAIN_IDS } from '@/configs/chains';
import { defineChain } from 'thirdweb';

const supportedChains = SUPPORTED_CHAIN_IDS.map((id) => defineChain(id));

interface WalletConnectButtonProps {
  size?: 'sm' | 'lg';
  className?: string;
}

// Empty string suppresses thirdweb's ENS/social avatar resolution.
// The app runs on Base/Sepolia, not mainnet, so ENS lookups fail.
const FALLBACK_AVATAR = '';

export const WalletConnectButton: React.FC<WalletConnectButtonProps> = ({ className = '' }) => {
  const { address } = useAccount();
  const { name: udName, avatar: udAvatar } = useUnstoppableDomain(address);
  const displayName = formatDisplayName(address, udName);

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
        // Suppress ENS/social avatar resolution — the app runs on Base/Sepolia,
        // not mainnet, so these lookups always fail with console errors.
        // Providing a non-undefined avatar URL prevents thirdweb from
        // attempting mainnet ENS lookups entirely.
        detailsButton={{
          connectedAccountName: displayName,
          connectedAccountAvatarUrl: udAvatar || FALLBACK_AVATAR,
        }}
        detailsModal={{
          connectedAccountName: displayName,
          connectedAccountAvatarUrl: udAvatar || FALLBACK_AVATAR,
        }}
        connectButton={{
          label: 'Connect Wallet',
        }}
      />
    </div>
  );
};

/**
 * Wallet Connect Button
 *
 * Renders thirdweb's ConnectButton for multi-chain wallet connection.
 * After wallet connection, the existing SIWE auth flow triggers automatically
 * via useWalletAuth (unchanged).
 */

import { ConnectButton } from 'thirdweb/react';
import { thirdwebClient } from '@/lib/thirdweb';
import { sepolia, baseSepolia, base } from 'thirdweb/chains';

const supportedChains = [sepolia, baseSepolia, base];

interface WalletConnectButtonProps {
  size?: 'sm' | 'lg';
  className?: string;
}

export const WalletConnectButton: React.FC<WalletConnectButtonProps> = ({ className = '' }) => {
  return (
    <div className={className}>
      <ConnectButton client={thirdwebClient} chains={supportedChains} theme="dark" />
    </div>
  );
};

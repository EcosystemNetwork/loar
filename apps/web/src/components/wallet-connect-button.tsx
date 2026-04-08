/**
 * Wallet Connect Button
 *
 * Renders Dynamic Labs' DynamicWidget for multi-chain wallet connection.
 * After wallet connection, the existing SIWE auth flow triggers automatically
 * via useWalletAuth (unchanged).
 *
 * For pages that also need SIWE verification state, import useWalletAuth directly.
 */

import { DynamicWidget } from '@dynamic-labs/sdk-react-core';

interface WalletConnectButtonProps {
  size?: 'sm' | 'lg';
  className?: string;
}

export const WalletConnectButton: React.FC<WalletConnectButtonProps> = ({ className = '' }) => {
  return (
    <div className={className}>
      <DynamicWidget />
    </div>
  );
};

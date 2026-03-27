/**
 * Wallet Connect Button
 *
 * Primary sign-in component using Coinbase Smart Wallet (v4) with social logins.
 * After wallet connection, automatically triggers SIWE signature verification.
 * Shows connected state with address, chain badge, and disconnect option.
 */

import { useAccount, useConnect } from 'wagmi';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Wallet, LogOut, Shield } from 'lucide-react';

interface WalletConnectButtonProps {
  size?: 'sm' | 'lg';
  className?: string;
}

export const WalletConnectButton: React.FC<WalletConnectButtonProps> = ({
  size = 'sm',
  className = '',
}) => {
  const { chain } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const {
    address,
    isConnected,
    isAuthenticated,
    isAuthenticating,
    error,
    signIn,
    signOut,
  } = useWalletAuth();

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  // Fully authenticated — show address + disconnect
  if (isAuthenticated && address) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {chain && (
          <span className="px-2 py-1 rounded-md bg-muted text-xs font-medium">
            {chain.name}
          </span>
        )}
        <span
          className={`px-3 py-2 rounded-md bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200 font-mono flex items-center gap-1.5 ${
            size === 'lg' ? 'text-base' : 'text-sm'
          }`}
        >
          <Shield className="h-3 w-3" />
          {truncateAddress(address)}
        </span>
        <button
          onClick={signOut}
          type="button"
          className="p-2 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          title="Disconnect wallet"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Connected but not yet SIWE-verified — prompt to sign
  if (isConnected && address && !isAuthenticated) {
    return (
      <div className={`flex flex-col items-center gap-2 ${className}`}>
        <button
          onClick={signIn}
          disabled={isAuthenticating}
          type="button"
          className={`px-4 py-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 font-medium ${
            size === 'lg' ? 'text-lg px-8 py-3' : 'text-sm'
          } ${isAuthenticating ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Shield className="h-4 w-4" />
          {isAuthenticating ? 'Verifying...' : 'Verify Wallet'}
        </button>
        {error && (
          <p className="text-xs text-destructive max-w-48 text-center">{error}</p>
        )}
      </div>
    );
  }

  // Not connected — show sign in button
  const connector = connectors[0];

  return (
    <div className={className}>
      <button
        onClick={() => connector && connect({ connector })}
        disabled={isConnecting || !connector}
        type="button"
        className={`px-4 py-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 font-medium ${
          size === 'lg' ? 'text-lg px-8 py-3' : 'text-sm'
        } ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Wallet className="h-4 w-4" />
        {isConnecting ? 'Signing in...' : 'Sign In'}
      </button>
    </div>
  );
};

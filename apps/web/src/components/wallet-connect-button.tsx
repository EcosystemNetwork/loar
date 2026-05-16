/**
 * Wallet Connect Button — Circle Auth Login
 *
 * Renders an email/social login button for the Circle DCW flow.
 * When authenticated, shows the user's abbreviated wallet address.
 * Clicking opens a dropdown with sign-out option.
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useWalletAuth, getAuthEmail } from '@/lib/wallet-auth';
import { useCircleSolanaAddress } from '@/hooks/useCircleSolanaAddress';
import { useUnstoppableDomain, formatDisplayName } from '@/hooks/useUnstoppableDomain';

interface WalletConnectButtonProps {
  size?: 'sm' | 'lg';
  className?: string;
}

export const WalletConnectButton: React.FC<WalletConnectButtonProps> = ({ className = '' }) => {
  const { address, isAuthenticated, signOut } = useWalletAuth();
  const { address: solanaAddress } = useCircleSolanaAddress(isAuthenticated);
  const { name: udName } = useUnstoppableDomain(address);
  const displayName = formatDisplayName(address, udName);
  const email = getAuthEmail();
  const [showMenu, setShowMenu] = useState(false);

  if (isAuthenticated && address) {
    return (
      <div className={`relative ${className}`}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/20 rounded-lg backdrop-blur-sm transition-all duration-200"
        >
          {/* Identicon */}
          <div
            className="w-6 h-6 rounded-full"
            style={{
              background: `linear-gradient(135deg, hsl(${parseInt(address.slice(2, 8), 16) % 360}, 70%, 60%), hsl(${parseInt(address.slice(8, 14), 16) % 360}, 70%, 40%))`,
            }}
          />
          <span className="text-sm font-medium text-white/90">
            {displayName || `${address.slice(0, 6)}…${address.slice(-4)}`}
          </span>
          <svg
            className={`w-3 h-3 text-white/60 transition-transform ${showMenu ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showMenu && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
            {/* Menu */}
            <div className="absolute right-0 top-full mt-2 z-50 w-56 bg-zinc-900 border border-white/10 rounded-lg shadow-xl overflow-hidden">
              {email && (
                <div className="px-4 py-3 border-b border-white/10">
                  <p className="text-xs text-white/50">Signed in as</p>
                  <p className="text-sm text-white/80 truncate">{email}</p>
                </div>
              )}
              <div className="px-4 py-3 border-b border-white/10">
                <p className="text-xs text-white/50">Wallet (EVM)</p>
                <p className="text-xs text-white/60 font-mono break-all">{address}</p>
              </div>
              {solanaAddress && (
                <div className="px-4 py-3 border-b border-white/10">
                  <p className="text-xs text-white/50">Solana</p>
                  <p className="text-xs text-white/60 font-mono break-all">{solanaAddress}</p>
                </div>
              )}
              <button
                onClick={() => {
                  setShowMenu(false);
                  signOut();
                }}
                className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-white/5 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Not authenticated — show connect/login button
  // The actual login form is on the /login page
  return (
    <div className={className}>
      <Link
        to="/login"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-medium text-sm rounded-lg shadow-lg shadow-indigo-500/25 transition-all duration-200 hover:shadow-indigo-500/40"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
          />
        </svg>
        Sign In
      </Link>
    </div>
  );
};

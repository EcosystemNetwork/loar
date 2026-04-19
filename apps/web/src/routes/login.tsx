/**
 * Login Route
 *
 * Wallet sign-in via thirdweb + SIWE.
 * After wallet connect + SIWE verification, redirects to ?redirect param or /dashboard.
 */

import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { useWalletAuth } from '@/lib/wallet-auth';
import { CHAIN_NAMES, SUPPORTED_CHAIN_IDS } from '@/configs/chains';
import { useEffect } from 'react';
import { z } from 'zod';

const loginSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute('/login')({
  component: LoginPage,
  validateSearch: loginSearchSchema,
});

function LoginPage() {
  const { isAuthenticated } = useWalletAuth();
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: '/login' });

  // Redirect once authenticated — only allow internal paths (prevent open redirect)
  useEffect(() => {
    if (isAuthenticated) {
      const target =
        redirect && redirect.startsWith('/') && !redirect.startsWith('//')
          ? redirect
          : '/dashboard';
      navigate({ to: target });
    }
  }, [isAuthenticated, navigate, redirect]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-10">
        {/* Brand */}
        <div className="text-center space-y-3">
          <img src="/loarIconTextLogo.png" alt="LOAR" className="h-10 w-auto mx-auto" />
          <p className="text-sm text-muted-foreground font-light">
            AI cinematic universes, on-chain
          </p>
        </div>

        {/* Sign In */}
        <div className="space-y-6">
          <div className="text-center space-y-1.5">
            <h1 className="text-2xl font-display italic">Sign in</h1>
            <p className="text-sm text-muted-foreground">Connect your wallet to get started</p>
          </div>

          <div className="flex justify-center">
            <WalletConnectButton size="lg" />
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
            <div className="flex-1 border-t border-border/50" />
            <span className="uppercase tracking-widest text-[10px]">
              {CHAIN_NAMES[SUPPORTED_CHAIN_IDS[0]] ?? 'Ethereum'}
            </span>
            <div className="flex-1 border-t border-border/50" />
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground/40">Secured by thirdweb</p>
      </div>
    </div>
  );
}

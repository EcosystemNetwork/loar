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

  // Redirect once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate({ to: redirect || '/dashboard' });
    }
  }, [isAuthenticated, navigate, redirect]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 text-center">
        {/* Logo */}
        <div className="space-y-4">
          <img src="/loarlogo.svg" alt="LOAR" className="h-16 w-auto mx-auto" />
          <h1 className="text-2xl font-bold tracking-tight">Welcome to LOAR</h1>
          <p className="text-muted-foreground">Decentralized Narrative Control Suite</p>
        </div>

        {/* Sign In Card */}
        <div className="rounded-xl border bg-card p-8 space-y-6 shadow-lg">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Sign In</h2>
            <p className="text-sm text-muted-foreground">
              Connect your Ethereum wallet to get started
            </p>
          </div>

          <div className="flex justify-center">
            <WalletConnectButton size="lg" />
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex-1 border-t" />
              <span>{CHAIN_NAMES[SUPPORTED_CHAIN_IDS[0]] ?? 'Ethereum'}</span>
              <div className="flex-1 border-t" />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Sign in with any Ethereum wallet.
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground">Powered by thirdweb</p>
      </div>
    </div>
  );
}

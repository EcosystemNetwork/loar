/**
 * Root Layout Route
 *
 * Top-level layout wrapping every page. Provides the ThemeProvider, toast
 * notifications, admin toolbar, and TanStack Router/Query devtools.
 * Shows a loading spinner while route transitions are in progress.
 */

import Loader from '@/components/loader';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import AdminToolbar from '@/components/admin-toolbar';
import { CookieConsent } from '@/components/CookieConsent';
import Header from '@/components/header';
import MobileBottomNav from '@/components/MobileBottomNav';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import type { trpc } from '@/utils/trpc';
import type { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  HeadContent,
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { useTrackWalletLogin } from '@/hooks/useTrackWalletLogin';
import { useRef, useEffect } from 'react';
import '../index.css';

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
  hasSession: () => boolean;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  pendingComponent: RootPending,
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
  head: () => ({
    meta: [
      {
        title: 'LOAR',
      },
      {
        name: 'description',
        content: 'Decentralized Narrative Control Suite',
      },
    ],
    links: [
      {
        rel: 'icon',
        href: '/favicon.ico',
      },
    ],
  }),
});

function RootPending() {
  return (
    <div className="h-svh flex items-center justify-center bg-background">
      <Loader />
    </div>
  );
}

function RootError({ error }: { error: Error }) {
  // Auto-reload once on chunk load failures (stale cache after redeployment)
  const isChunkError =
    error?.message?.includes('Failed to fetch dynamically imported module') ||
    error?.message?.includes('Importing a module script failed');
  if (isChunkError && !sessionStorage.getItem('chunk_reload')) {
    sessionStorage.setItem('chunk_reload', '1');
    window.location.reload();
    return null;
  }
  sessionStorage.removeItem('chunk_reload');

  return (
    <div className="h-svh flex flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md text-center">
        {error?.message || 'An unexpected error occurred.'}
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
      >
        Reload Page
      </button>
    </div>
  );
}

function RootNotFound() {
  return (
    <div className="h-svh flex flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">This page doesn't exist.</p>
      <Link
        to="/"
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
      >
        Go Home
      </Link>
    </div>
  );
}

function AuthErrorWatcher() {
  const { error, needsManualSignIn, signIn } = useWalletAuth();
  const prevError = useRef<string | null>(null);
  const shownManualSignIn = useRef(false);

  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error('Sign-in failed', { description: error, duration: 8000 });
    } else if (!error) {
      prevError.current = null;
    }
  }, [error]);

  // Surface when auto-sign-in exhausted — prompt user to sign manually
  useEffect(() => {
    if (needsManualSignIn && !shownManualSignIn.current) {
      shownManualSignIn.current = true;
      toast.info('Wallet connected but not signed in', {
        description: 'Click below to complete sign-in.',
        action: {
          label: 'Sign In',
          onClick: () => signIn(),
        },
        duration: 15000,
      });
    } else if (!needsManualSignIn) {
      shownManualSignIn.current = false;
    }
  }, [needsManualSignIn, signIn]);

  return null;
}

function RootComponent() {
  useTrackWalletLogin();

  const isLoading = useRouterState({
    select: (s) => s.isLoading,
  });

  return (
    <ErrorBoundary>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        {/* Route transition progress bar — keeps layout stable, no page flash */}
        {isLoading && <div className="route-progress-bar" aria-hidden="true" />}
        <div className="min-h-svh flex flex-col">
          <Header />
          <AuthErrorWatcher />
          {/* Testnet warning banner — only visible in testnet mode */}
          {(import.meta.env.VITE_CHAIN_ENV ?? 'testnet') === 'testnet' && (
            <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-center text-sm text-amber-600 dark:text-amber-400">
              <strong>Testnet beta</strong> — Universes will be migrated onchain with real value.{' '}
              <Link to="/testnet" className="underline underline-offset-2 hover:text-amber-300">
                What's live, what's not →
              </Link>
            </div>
          )}
          <main className="flex-1">
            <Outlet />
          </main>
          <footer className="border-t py-6 px-4 pb-bottom-nav md:pb-6">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span>&copy; {new Date().getFullYear()} LOAR</span>
              <Link to="/terms" className="hover:text-foreground transition-colors">
                Terms of Service
              </Link>
              <Link to="/privacy" className="hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              <Link to="/dmca" className="hover:text-foreground transition-colors">
                DMCA
              </Link>
              <Link to="/status" className="hover:text-foreground transition-colors">
                Status
              </Link>
              <Link to="/testnet" className="hover:text-foreground transition-colors">
                Testnet
              </Link>
            </div>
          </footer>
          <MobileBottomNav />
        </div>
        <Toaster richColors position="top-right" toastOptions={{ duration: 5000 }} />
        <AdminToolbar />
        <CookieConsent />
      </ThemeProvider>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-left" />}
      {import.meta.env.DEV && (
        <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
      )}
    </ErrorBoundary>
  );
}

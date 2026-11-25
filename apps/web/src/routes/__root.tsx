/**
 * Root Layout Route
 *
 * Top-level layout wrapping every page. Provides the ThemeProvider, toast
 * notifications, admin toolbar, and TanStack Router/Query devtools.
 * Shows a loading spinner while route transitions are in progress.
 */

import Loader from '@/components/loader';
import { EmptyState, ErrorState, stateActionClass } from '@/components/states';
import { Compass } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AdminToolbarGate } from '@/components/AdminToolbarGate';
import { CookieConsent } from '@/components/CookieConsent';
import { ApiKeyGateModal } from '@/components/ApiKeyGateModal';
import Header from '@/components/header';
import MobileBottomNav from '@/components/MobileBottomNav';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import type { trpc } from '@/utils/trpc';
import type { QueryClient } from '@tanstack/react-query';
import {
  HeadContent,
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router';
import { useTrackWalletLogin } from '@/hooks/useTrackWalletLogin';
import { lazy, Suspense, useRef, useEffect } from 'react';
import '../index.css';
import { BRAND } from '@/lib/brand';

// Dev-only. `import.meta.env.DEV` is a build-time constant, so in production
// the dynamic imports are dead-code-eliminated and the devtools packages
// (~130KB) never reach the bundle.
const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-router-devtools').then((m) => ({
        default: m.TanStackRouterDevtools,
      }))
    )
  : null;
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools }))
    )
  : null;

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
        title: BRAND.title,
      },
      {
        name: 'description',
        content: BRAND.tagline,
      },
    ],
    // No favicon `links` entry here on purpose: index.html already declares
    // <link rel="icon" href="loarButton_Logo.png"> statically, so it's live
    // at first paint. A second rel="icon" injected here by HeadContent after
    // hydration raced it and caused the tab icon to flip/disappear depending
    // on browser favicon-cache behavior.
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
    <div className="min-h-svh flex flex-col bg-background text-foreground">
      <BrandBar />
      <ErrorState
        variant="page"
        title="Something went wrong"
        description="This page hit an error. Reloading usually fixes it — if not, head home and try again."
        error={error}
        onRetry={() => window.location.reload()}
        retryLabel="Reload page"
        secondaryAction={
          <a href="/" className={stateActionClass.secondary}>
            Go home
          </a>
        }
        className="flex-1"
      />
    </div>
  );
}

/** Logo-only bar for the root error screen, which renders without the app header. */
function BrandBar() {
  return (
    <div className="flex h-14 items-center px-4 lg:px-6">
      <a href="/" aria-label="LOAR home">
        <img src="/loarIconTextLogo.png" alt="LOAR" className="h-7 w-auto" />
      </a>
    </div>
  );
}

function RootNotFound() {
  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <EmptyState
        variant="page"
        icon={Compass}
        title="This world doesn’t exist (yet)"
        description="The link may be old, or the universe may have moved. Try one of these instead."
        actions={
          <>
            <Link to="/discover" className={stateActionClass.primary}>
              Discover universes
            </Link>
            <Link to="/create" className={stateActionClass.secondary}>
              Create
            </Link>
            <Link to="/" className={stateActionClass.secondary}>
              Home
            </Link>
          </>
        }
        className="flex-1"
      />
    </div>
  );
}

function AuthErrorWatcher() {
  const { error } = useWalletAuth();
  // /login renders the same error inline beneath the form — toasting on top
  // double-displays it, so we suppress here when the user is on that page.
  const onLoginPage = useRouterState({
    select: (s) => s.location.pathname === '/login',
  });
  const prevError = useRef<string | null>(null);

  useEffect(() => {
    if (onLoginPage) {
      prevError.current = error;
      return;
    }
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error('Sign-in failed', { description: error, duration: 8000 });
    } else if (!error) {
      prevError.current = null;
    }
  }, [error, onLoginPage]);

  return null;
}

function RootComponent() {
  useTrackWalletLogin();

  const isLoading = useRouterState({
    select: (s) => s.isLoading,
  });

  // Home (`/`) is a locked single-viewport experience — hide the footer there
  // so the page never needs to scroll vertically.
  const isHome = useRouterState({
    select: (s) => s.location.pathname === '/',
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
          <main className="flex-1">
            <Outlet />
          </main>
          {!isHome && (
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
                <a
                  href="https://t.me/+AXD-XK8SVvw5MTIx"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  Telegram
                </a>
                <a
                  href="https://x.com/LOAR_FUN"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  X
                </a>
              </div>
            </footer>
          )}
          <MobileBottomNav />
        </div>
        <Toaster richColors position="top-right" toastOptions={{ duration: 5000 }} />
        <AdminToolbarGate />
        <CookieConsent />
        <ApiKeyGateModal />
      </ThemeProvider>
      {TanStackRouterDevtools && ReactQueryDevtools && (
        <Suspense fallback={null}>
          <TanStackRouterDevtools position="bottom-left" />
          <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}

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
import Header from '@/components/header';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
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
import '../index.css';

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
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
        <div className="min-h-svh flex flex-col">
          {isLoading ? (
            <Loader />
          ) : (
            <>
              <Header />
              <main className="flex-1">
                <Outlet />
              </main>
              <footer className="border-t py-6 px-4">
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
                </div>
              </footer>
            </>
          )}
        </div>
        <Toaster richColors />
        <AdminToolbar />
      </ThemeProvider>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-left" />}
      {import.meta.env.DEV && (
        <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
      )}
    </ErrorBoundary>
  );
}

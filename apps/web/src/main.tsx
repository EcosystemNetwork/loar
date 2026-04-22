/**
 * Application Entry Point
 *
 * Bootstraps the React app with:
 * - TanStack Router (file-based routing with code-gen route tree)
 * - TanStack React Query (via QueryClientProvider)
 * - Wagmi wallet provider (WalletProvider)
 *
 * The router's Wrap component nests all global providers so that
 * route loaders have access to tRPC and the query client.
 */

import { validateWebEnv } from './lib/env';
validateWebEnv();

// Side-effect import: initializes Sentry if VITE_SENTRY_DSN is set.
// Must run before router/providers so bootstrap errors are captured.
import './lib/sentry';

// Product analytics — PostHog. Lazy-loads when VITE_POSTHOG_KEY is set,
// silent no-op otherwise. Autocaptures clicks + pageviews + session replay.
import { initAnalytics } from './lib/analytics';
void initAnalytics();

// Auto-reload when a deployed chunk is missing (stale cache after redeployment)
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  window.location.reload();
});

import { RouterProvider, createRouter } from '@tanstack/react-router';
import ReactDOM from 'react-dom/client';
import Loader from './components/loader';
import { routeTree } from './routeTree.gen';

import { queryClient, trpc } from './utils/trpc';

import { trackPageView } from './lib/ga';
import { WalletProvider } from './lib/wallet-provider';
import { Web3ModeProvider } from './lib/web3-mode';
import { hasSession } from './lib/wallet-auth';

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingComponent: () => <Loader />,
  context: { trpc, queryClient, hasSession },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return (
      <WalletProvider queryClient={queryClient}>
        <Web3ModeProvider>{children}</Web3ModeProvider>
      </WalletProvider>
    );
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

router.subscribe('onResolved', () => {
  const matches = router.state.matches;
  const last = matches[matches.length - 1];
  if (last) trackPageView(last.fullPath);
});

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Root element not found');
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<RouterProvider router={router} />);
}

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

// Retry IPFS image/video loads against public gateways when the configured
// Pinata gateway 403s unpinned CIDs.
import { installGlobalIpfsFallback } from './utils/install-ipfs-fallback';
installGlobalIpfsFallback();

// Offline-video service worker. Fire-and-forget — caches episodes the user
// explicitly flags via the "Save offline" button. No app-shell caching.
import { registerOfflineWorker } from './lib/offline-cache';
void registerOfflineWorker();

import { RouterProvider, createRouter } from '@tanstack/react-router';
import ReactDOM from 'react-dom/client';
import Loader from './components/loader';
import { routeTree } from './routeTree.gen';

import { queryClient, trpc } from './utils/trpc';

// M-1: one-shot stale-cache invalidation across deploys. Bumping CACHE_VERSION
// flushes only the persona cache (the M1-affected key) for any user whose
// localStorage was hydrated before this deploy. We use removeQueries rather
// than queryClient.clear() so unrelated cached data (wallet balances, gallery,
// etc.) is preserved across the upgrade.
const CACHE_VERSION = '2026-05-17-v1';
const CACHE_VERSION_KEY = 'loar_query_cache_version';
try {
  const storedVersion = localStorage.getItem(CACHE_VERSION_KEY);
  if (storedVersion !== CACHE_VERSION) {
    queryClient.removeQueries({ queryKey: ['persona'] });
    localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
  }
} catch {
  // localStorage unavailable (SSR / private mode) — skip the version check.
}

import { trackPageView } from './lib/ga';
import { WalletProvider } from './lib/wallet-provider';
import { Web3ModeProvider } from './lib/web3-mode';
import { hasSession } from './lib/wallet-auth';
import { TxConfirmRoot } from './components/tx-confirm';

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingComponent: () => <Loader />,
  context: { trpc, queryClient, hasSession },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return (
      <WalletProvider queryClient={queryClient}>
        <Web3ModeProvider>
          {children}
          {/* WEB-4: singleton tx-confirm modal mounted once at the root.
              Hooks across the app call `confirmTx({...})` before every
              writeContractAsync / sendTransaction. */}
          <TxConfirmRoot />
        </Web3ModeProvider>
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

/**
 * Application Entry Point
 *
 * Bootstraps the React app with:
 * - TanStack Router (file-based routing with code-gen route tree)
 * - TanStack React Query (via QueryClientProvider)
 * - Wagmi wallet provider (WalletWrapper)
 *
 * The router's Wrap component nests all global providers so that
 * route loaders have access to tRPC and the query client.
 */

import { validateWebEnv } from './lib/env';
validateWebEnv();

import { RouterProvider, createRouter } from '@tanstack/react-router';
import ReactDOM from 'react-dom/client';
import Loader from './components/loader';
import { routeTree } from './routeTree.gen';

import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient, trpc } from './utils/trpc';

import { WalletWrapper } from './lib/wallet-provider';

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingComponent: () => <Loader />,
  context: { trpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <WalletWrapper>{children}</WalletWrapper>
      </QueryClientProvider>
    );
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Root element not found');
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<RouterProvider router={router} />);
}

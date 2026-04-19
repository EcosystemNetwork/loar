/**
 * tRPC Client Configuration
 *
 * Sets up the tRPC client and React Query client for server communication.
 * - `queryClient`: Shared React Query client with retry logic and error toasts.
 * - `trpcClient`: Vanilla tRPC client for imperative calls (e.g., in hooks/callbacks).
 * - `trpc`: TanStack React Query-integrated tRPC proxy for use in components and loaders.
 *
 * Authentication is handled automatically via httpOnly session cookies.
 * The browser sends the cookie on every request (credentials: 'include').
 */

import type { AppRouter } from '@loar/shared/trpc';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { toast } from 'sonner';

/** Shared React Query client. Retries 5xx errors and shows toast on failure. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s default — prevents refetch-on-every-mount flickering
      refetchOnWindowFocus: false, // Prevent refetch storms when tab regains focus
      retry: (failureCount, error: any) => {
        if (error?.data?.httpStatus >= 500 && failureCount < 3) {
          return true;
        }
        return false;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: (failureCount, error: any) => {
        if (error?.data?.httpStatus >= 500 && failureCount < 2) {
          return true;
        }
        return false;
      },
      retryDelay: 2000,
    },
  },
  mutationCache: new MutationCache({
    onError: (error: any, _variables, _context, mutation) => {
      // Skip if the mutation already has its own onError handler
      if (mutation.options.onError) return;

      if (
        error.message === 'Failed to fetch' ||
        error.message?.includes('ERR_CONNECTION_REFUSED')
      ) {
        return;
      }
      // Log raw error for debugging, show sanitized message to user
      console.error('[mutation error]', error.message);
      toast.error(
        error.message?.toLowerCase().includes('unauthorized')
          ? 'Unauthorized'
          : 'An error occurred. Please try again.'
      );
    },
  }),
  queryCache: new QueryCache({
    onError: (error: any, query: any) => {
      // Skip errors from queries that opt out via meta.silent or skipGlobalErrorHandler
      if (query?.meta?.silent || query?.meta?.skipGlobalErrorHandler) return;

      // Don't toast on contract reverts (expected for some reads like getCanonChain)
      if (error.message?.includes('reverted') || error.name === 'ContractFunctionExecutionError') {
        return;
      }

      // Don't toast on network errors (server/indexer not running)
      if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
        return;
      }

      // Don't toast on missing procedures (server deploy lag)
      if (error.message?.includes('No procedure found')) {
        return;
      }

      // Handle expired/invalid JWT — verify with /auth/me before clearing session.
      // A single 401 from one procedure is not proof the session is dead (could be
      // a per-endpoint auth race, a bug, or a transient server issue). Wiping
      // localStorage on every 401 falsely logs out users whose cookie is valid —
      // e.g. infinite-scroll queries hitting one bad 401. Only clear if /auth/me
      // confirms the cookie is no longer accepted.
      const httpStatus = error?.data?.httpStatus ?? error?.status;
      if (httpStatus === 401 || error.message?.includes('UNAUTHORIZED')) {
        const address = localStorage.getItem('siwe-address');
        const expiry = localStorage.getItem('siwe-expiry');
        const hadSession = !!(address && expiry && Date.now() < Number(expiry));
        if (!hadSession) return;

        void fetch(`${import.meta.env.VITE_SERVER_URL || ''}/auth/me`, {
          credentials: 'include',
        })
          .then((r) => r.json())
          .then((data) => {
            if (data?.authenticated) return; // Cookie still valid — single-query 401, keep session
            // Dynamic import avoids the wagmi/thirdweb TDZ from a synchronous
            // wallet-auth import at module init.
            return import('../lib/wallet-auth').then(({ clearSiweSession }) => {
              clearSiweSession();
              toast.error('Session expired. Please sign in again.', {
                id: 'session-expired', // dedupe — one toast even if multiple queries fail
              });
            });
          })
          .catch(() => {
            // Network error reaching /auth/me — assume transient, keep session.
          });
        return;
      }

      // Log raw error for debugging, show sanitized message to user
      console.error('[query error]', error.message);
      toast.error(
        error.message?.toLowerCase().includes('unauthorized')
          ? 'Unauthorized'
          : 'An error occurred. Please try again.',
        {
          action: {
            label: 'retry',
            onClick: () => {
              queryClient.invalidateQueries();
            },
          },
        }
      );
    },
  }),
});

/** Vanilla tRPC client for imperative (non-hook) usage. */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${import.meta.env.VITE_SERVER_URL || ''}/trpc`,
      // httpOnly cookie is sent automatically via credentials: 'include'
      fetch(url, options) {
        return fetch(url, { ...options, credentials: 'include' });
      },
    }),
  ],
});

/** TanStack React Query-integrated tRPC proxy for use in components and route loaders. */
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});

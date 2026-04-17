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
      // Skip errors from queries that opt out via meta.silent
      if (query?.meta?.silent) return;

      // Don't toast on contract reverts (expected for some reads like getCanonChain)
      if (error.message?.includes('reverted') || error.name === 'ContractFunctionExecutionError') {
        return;
      }

      // Don't toast on network errors (server/indexer not running)
      if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
        return;
      }

      // Handle expired/invalid JWT — clear session and prompt re-auth.
      // Only toast if the user actually had a session; unauthenticated 401s are expected.
      // Note: we inline the localStorage logic here instead of importing from wallet-auth
      // to avoid a circular dependency (wallet-auth imports wagmi/thirdweb which have
      // internal circular deps that cause TDZ errors when loaded synchronously).
      const httpStatus = error?.data?.httpStatus ?? error?.status;
      if (httpStatus === 401 || error.message?.includes('UNAUTHORIZED')) {
        const address = localStorage.getItem('siwe-address');
        const expiry = localStorage.getItem('siwe-expiry');
        const hadSession = !!(address && expiry && Date.now() < Number(expiry));
        localStorage.removeItem('siwe-address');
        localStorage.removeItem('siwe-expiry');
        if (hadSession) {
          toast.error('Session expired. Please sign in again.', {
            id: 'session-expired', // dedupe — one toast even if multiple queries fail
          });
        }
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

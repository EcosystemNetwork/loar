/**
 * tRPC Client Configuration
 *
 * Sets up the tRPC client and React Query client for server communication.
 * - `queryClient`: Shared React Query client with retry logic and error toasts.
 * - `trpcClient`: Vanilla tRPC client for imperative calls (e.g., in hooks/callbacks).
 * - `trpc`: TanStack React Query-integrated tRPC proxy for use in components and loaders.
 *
 * Authentication is handled automatically -- the httpBatchLink injects the
 * SIWE JWT session token as a Bearer header on every request.
 */

import type { AppRouter } from '@loar/shared/trpc';
import { QueryCache, QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { toast } from 'sonner';
import { getSiweToken, clearSiweSession } from '../lib/wallet-auth';

/** Shared React Query client. Retries 5xx errors and shows toast on failure. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s default — prevents refetch-on-every-mount flickering
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
  queryCache: new QueryCache({
    onError: (error: any) => {
      // Don't toast on network errors (server/indexer not running)
      if (error.message === 'Failed to fetch' || error.message.includes('ERR_CONNECTION_REFUSED')) {
        return;
      }

      // Handle expired/invalid JWT — clear session and prompt re-auth
      const httpStatus = error?.data?.httpStatus ?? error?.status;
      if (httpStatus === 401 || error.message?.includes('UNAUTHORIZED')) {
        clearSiweSession();
        toast.error('Session expired. Please sign in again.', {
          id: 'session-expired', // dedupe — one toast even if multiple queries fail
        });
        return;
      }

      toast.error(error.message, {
        action: {
          label: 'retry',
          onClick: () => {
            queryClient.invalidateQueries();
          },
        },
      });
    },
  }),
});

/** Vanilla tRPC client for imperative (non-hook) usage. */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${import.meta.env.VITE_SERVER_URL}/trpc`,
      headers() {
        const token = getSiweToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

/** TanStack React Query-integrated tRPC proxy for use in components and route loaders. */
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});

/**
 * Shared React Query client — extracted to its own module so it can be
 * imported synchronously from anywhere (notably `lib/wallet-auth.ts`)
 * without introducing a circular dependency with `utils/trpc.ts`, which
 * dynamically imports wallet-auth for 401 handling.
 *
 * M-2 fix: previously `clearSiweSession` did a fire-and-forget dynamic
 * import of `utils/trpc` to call `queryClient.clear()`. That import could
 * resolve AFTER a subsequent re-login, wiping the freshly-fetched data of
 * the new user. Synchronous import here eliminates the race.
 *
 * The full QueryClient (with retry/cache/toast handlers) is still
 * constructed in `utils/trpc.ts` — this module just re-exports it from
 * there once trpc.ts has built it. Actually we flipped the dependency:
 * trpc.ts now imports `queryClient` from this module, and this module
 * owns the full construction.
 */

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// Mirror of SERVER_URL resolution from utils/trpc.ts. Kept here so the
// queryCache onError handler (which calls /auth/me) can run without
// importing trpc.ts (avoids circular).
const PROD_SERVER_URL = 'https://api.loar.fun';
const RAW_SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').trim().replace(/\/$/, '');

export const SERVER_URL = (() => {
  if (import.meta.env.PROD) {
    if (RAW_SERVER_URL && RAW_SERVER_URL !== PROD_SERVER_URL) {
      // eslint-disable-next-line no-console
      console.warn(
        `[trpc] VITE_SERVER_URL="${RAW_SERVER_URL}" ignored in production build; using ${PROD_SERVER_URL}`
      );
    }
    return PROD_SERVER_URL;
  }
  return RAW_SERVER_URL || '';
})();

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

        // No address stored → no session to clear, just bail.
        if (!address) return;

        // Local expiry already past → clear immediately. Without this branch,
        // expired-but-still-stored sessions cause polling queries (LoarBalance,
        // notifications, etc.) to retry forever: enabled=isAuthenticated stays
        // true because storedAddress is non-null, but every request 401s.
        const expiryMs = expiry ? Number(expiry) : 0;
        if (!expiryMs || Date.now() >= expiryMs) {
          void import('../lib/wallet-auth').then(({ clearSiweSession }) => {
            clearSiweSession();
            toast.error('Session expired. Please sign in again.', {
              id: 'session-expired',
            });
          });
          return;
        }

        // Local session looks live — verify with /auth/me before clearing.
        void fetch(`${SERVER_URL}/auth/me`, {
          credentials: 'include',
        })
          .then((r) => r.json())
          .then((data) => {
            if (data?.authenticated) return; // Cookie still valid — single-query 401, keep session
            // Dynamic import avoids a wagmi TDZ from a synchronous
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

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
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';

// M-2: queryClient + SERVER_URL live in `./query-client` so wallet-auth can
// import them synchronously without a circular dependency. Re-exported here
// for backward compatibility with the many call sites that do
// `import { queryClient, SERVER_URL } from '@/utils/trpc'`.
import { queryClient, SERVER_URL } from './query-client';
export { queryClient, SERVER_URL };

/** Vanilla tRPC client for imperative (non-hook) usage. */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${SERVER_URL}/trpc`,
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

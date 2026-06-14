/**
 * tRPC client for mobile.
 * Mirrors apps/web/src/utils/trpc.ts but uses SecureStore for the auth token.
 */
import type { AppRouter } from '@loar/shared/trpc';
import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { inferRouterOutputs } from '@trpc/server';
import * as SecureStore from 'expo-secure-store';

/**
 * Inferred output types of every server procedure. Use these to type query
 * results explicitly — mobile pins TypeScript 5.3.x, which is below the 5.7.2
 * that `@trpc/tanstack-react-query` needs to infer `queryOptions()` data, so
 * `.map`/`.filter` over query data otherwise trips `noImplicitAny`.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:3000';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        const trpcError = error as { data?: { httpStatus?: number } } | null;
        if (trpcError?.data?.httpStatus && trpcError.data.httpStatus >= 500 && failureCount < 3) {
          return true;
        }
        return false;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      staleTime: 30_000,
    },
  },
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${SERVER_URL}/trpc`,
      async headers() {
        const token = await SecureStore.getItemAsync('siwe-token');
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});

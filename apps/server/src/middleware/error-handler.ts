/**
 * Global error handler middleware for Hono.
 * Returns a consistent error envelope on all non-tRPC routes:
 * { code: string, message: string, details?: unknown }
 */
import type { Context } from 'hono';

export function errorHandler(err: Error, c: Context) {
  console.error('Unhandled error:', err);

  const isDev = process.env.NODE_ENV === 'development';

  return c.json(
    {
      code: 'INTERNAL_SERVER_ERROR',
      message: isDev ? err.message : 'Something went wrong',
      ...(isDev && err.stack ? { details: { stack: err.stack } } : {}),
    },
    500
  );
}

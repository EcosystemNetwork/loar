/**
 * Global error handler middleware for Hono.
 * Returns a consistent error envelope on all non-tRPC routes:
 * { code: string, message: string, details?: unknown }
 */
import type { Context } from 'hono';
import { captureException, sentryEnabled } from '../lib/sentry';

export function errorHandler(err: Error, c: Context) {
  console.error('Unhandled error:', err);

  // Report 500-level errors to Sentry (skip 4xx client errors)
  if (sentryEnabled) {
    captureException(err, {
      extra: {
        method: c.req.method,
        url: c.req.url,
        path: c.req.path,
      },
    });
  }

  // Only expose error details when LOAR_DEBUG_ERRORS is explicitly set.
  // Using NODE_ENV alone risks leaking stack traces if dev mode is
  // accidentally enabled in production.
  const showDetails = process.env.LOAR_DEBUG_ERRORS === 'true';

  return c.json(
    {
      code: 'INTERNAL_SERVER_ERROR',
      message: showDetails ? err.message : 'Something went wrong',
      ...(showDetails && err.stack ? { details: { stack: err.stack } } : {}),
    },
    500
  );
}

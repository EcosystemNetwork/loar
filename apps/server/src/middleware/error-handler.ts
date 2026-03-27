/**
 * Global error handler middleware for Hono.
 * Returns sanitized error messages in production, detailed errors in development.
 */
import type { Context } from 'hono';

export function errorHandler(err: Error, c: Context) {
  console.error('Unhandled error:', err);

  return c.json(
    {
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    },
    500
  );
}

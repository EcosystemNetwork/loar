/**
 * Consistent error envelope for all API responses.
 *
 * tRPC already wraps errors in a standard shape, but procedure-level throws
 * are inconsistent (some throw plain Error, some throw TRPCError with varying detail).
 * This module normalizes that into a single pattern.
 *
 * Error envelope shape:
 * {
 *   code: string;        // tRPC error code (e.g. "BAD_REQUEST", "NOT_FOUND")
 *   message: string;     // Human-readable message
 *   details?: unknown;   // Optional structured details (validation errors, etc.)
 * }
 */
import { TRPCError } from '@trpc/server';

type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_SERVER_ERROR';

/**
 * Throw a normalized tRPC error. Use this instead of `throw new TRPCError(...)` directly
 * to ensure all errors follow the same envelope shape.
 */
export function throwApiError(code: ErrorCode, message: string, details?: unknown): never {
  throw new TRPCError({
    code: mapToTRPCCode(code),
    message,
    cause: details ? { details } : undefined,
  });
}

/**
 * Wrap an unknown caught error into a normalized TRPCError.
 * Preserves the original message for known Error instances, sanitizes unknown values.
 */
export function wrapError(
  error: unknown,
  fallbackMessage = 'An unexpected error occurred'
): TRPCError {
  if (error instanceof TRPCError) return error;

  const message = error instanceof Error ? error.message : fallbackMessage;
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message,
    cause: error,
  });
}

function mapToTRPCCode(code: ErrorCode): ConstructorParameters<typeof TRPCError>[0]['code'] {
  const map: Record<ErrorCode, ConstructorParameters<typeof TRPCError>[0]['code']> = {
    BAD_REQUEST: 'BAD_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
    TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  };
  return map[code];
}

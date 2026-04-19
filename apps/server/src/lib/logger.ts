/**
 * Structured logging for the LOAR server.
 *
 * - Emits JSON in production (one object per line, trivially shipped to Loki /
 *   Datadog / CloudWatch Logs).
 * - Pretty-prints in development for human readability.
 * - `redact` strips common secret-bearing fields before they reach logs.
 *
 * Use `logger.child({ ... })` to attach request-scoped context (reqId, wallet,
 * job id) rather than concatenating strings into the message.
 */
import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug');

export const logger = pino({
  level,
  base: {
    service: 'loar-server',
    env: process.env.NODE_ENV ?? 'development',
  },
  redact: {
    paths: [
      'authorization',
      'cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      'password',
      'privateKey',
      'private_key',
      'jwt',
      'token',
      '*.privateKey',
      '*.password',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  transport:
    !isProduction && process.stdout.isTTY
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service,env',
          },
        }
      : undefined,
});

/** Convenience factory for per-request or per-job child loggers. */
export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}

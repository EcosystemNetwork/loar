/**
 * Sentry error monitoring — initializes only when SENTRY_DSN is set.
 * Import this module early (after dotenv) to capture errors globally.
 */
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;
const isProduction = process.env.NODE_ENV === 'production';

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: isProduction ? 0.1 : 1.0,
  });
  console.log(`[sentry] Initialized (env=${process.env.NODE_ENV})`);
} else {
  console.log('[sentry] SENTRY_DSN not set — error reporting disabled');
}

export const captureException = Sentry.captureException.bind(Sentry);
export const captureMessage = Sentry.captureMessage.bind(Sentry);

/** Whether Sentry is active (DSN was provided). */
export const sentryEnabled = Boolean(dsn);

/**
 * Sentry error monitoring for the React Native mobile app.
 *
 * Initialization is gated on EXPO_PUBLIC_SENTRY_DSN — when unset, Sentry is
 * inert and imports are effectively free. The DSN is a public write-only
 * key so it's safe to bake into the app bundle.
 *
 * IMPORTANT: JavaScript errors are captured immediately on install. Native
 * (iOS/Android) crash capture requires `expo prebuild` + a native rebuild
 * so that `@sentry/react-native` can link its SDK. Until then, this module
 * captures JS-layer crashes only — plenty of value on its own.
 *
 * Release tagging via EXPO_PUBLIC_RELEASE (same as web's VITE_RELEASE) so
 * Sentry groups errors by deployed version; inject at build time from CI
 * (e.g. `EXPO_PUBLIC_RELEASE=$(git rev-parse --short HEAD)`).
 */
import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
const release = process.env.EXPO_PUBLIC_RELEASE;
const env = process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? 'development' : 'production');
const isProduction = env === 'production';

export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: env,
    release,
    // Conservative sampling: full sampling in dev, 10% in prod.
    tracesSampleRate: isProduction ? 0.1 : 1.0,
    // Don't auto-capture all console calls — too noisy for mobile.
    attachStacktrace: true,
    // Don't send events for typical user-cancellation errors.
    ignoreErrors: [
      /Network request failed/i,
      /Non-Error exception captured/i,
      /Non-Error promise rejection captured/i,
      /TypeError: Failed to fetch/i,
    ],
    beforeSend(event) {
      // Drop dev events entirely — we only want prod telemetry.
      if (!isProduction) return null;
      return event;
    },
  });
  // eslint-disable-next-line no-console
  console.log(`[sentry] Initialized (env=${env})`);
}

export const captureException = Sentry.captureException.bind(Sentry);
export const captureMessage = Sentry.captureMessage.bind(Sentry);
export const setUser = Sentry.setUser.bind(Sentry);
export const setTag = Sentry.setTag.bind(Sentry);

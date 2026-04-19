/**
 * Sentry error monitoring for the web app — initializes only when
 * VITE_SENTRY_DSN is set. Import for side effects from `main.tsx` before
 * the router mounts so bootstrap errors are captured.
 */
import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const envName = (import.meta.env.MODE || 'development') as string;
const isProduction = envName === 'production';
const release = (import.meta.env.VITE_RELEASE as string | undefined) ?? undefined;

export const sentryEnabled = Boolean(dsn);

// Session replay captures user interactions — gated behind explicit 'all'
// consent per GDPR/ePrivacy. Error reporting itself is considered essential
// (required to keep the service running) and stays enabled.
// When consent is given at page load we attach the replay integration here;
// when consent is given later via the banner, CookieConsent uses
// `Sentry.addIntegration(Sentry.replayIntegration(...))` to attach it at
// runtime without a disruptive reload. Sample rates are always set so the
// runtime-added integration picks them up immediately.
const consent =
  typeof window !== 'undefined' ? window.localStorage.getItem('loar_consent_v1') : null;
const replayAllowed = consent === 'all';

if (dsn) {
  Sentry.init({
    dsn,
    environment: envName,
    release,
    integrations: [
      Sentry.browserTracingIntegration(),
      ...(replayAllowed
        ? [
            Sentry.replayIntegration({
              maskAllText: false,
              blockAllMedia: false,
            }),
          ]
        : []),
    ],
    tracesSampleRate: isProduction ? 0.1 : 1.0,
    replaysSessionSampleRate: isProduction ? 0.1 : 0,
    replaysOnErrorSampleRate: 1.0,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
    ],
    beforeSend(event) {
      if (!isProduction) return event;
      if (event.request?.url?.includes('localhost')) return null;
      return event;
    },
  });
  // eslint-disable-next-line no-console
  console.log(`[sentry] Initialized (env=${envName}, replay=${replayAllowed ? 'on' : 'off'})`);
}

export const captureException = Sentry.captureException.bind(Sentry);
export const captureMessage = Sentry.captureMessage.bind(Sentry);
export const setUser = Sentry.setUser.bind(Sentry);
export const setTag = Sentry.setTag.bind(Sentry);

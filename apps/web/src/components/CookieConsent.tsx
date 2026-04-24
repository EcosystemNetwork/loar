/**
 * Cookie / tracking consent banner (GDPR / ePrivacy).
 *
 * State model — three possibilities:
 *   null       — user has not yet chosen; show banner
 *   'all'      — accepted analytics + session-replay tracking
 *   'essential'— rejected non-essential tracking
 *
 * Persisted in localStorage as `loar_consent_v1`. Versioned so we can force a
 * re-prompt if scope of tracking changes. Sentry Session Replay only starts
 * after consent is 'all' — see `src/lib/sentry.ts`.
 */
import { useEffect, useState } from 'react';
import { QA_EVENTS } from '@/lib/qa-events';

export const CONSENT_KEY = 'loar_consent_v1';
export type ConsentLevel = 'all' | 'essential';

export function readConsent(): ConsentLevel | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(CONSENT_KEY);
  return raw === 'all' || raw === 'essential' ? raw : null;
}

export function writeConsent(level: ConsentLevel) {
  window.localStorage.setItem(CONSENT_KEY, level);
  window.dispatchEvent(new CustomEvent('loar:consent', { detail: level }));
}

export function CookieConsent() {
  const [level, setLevel] = useState<ConsentLevel | null>(() => readConsent());

  useEffect(() => {
    // No-op — re-render trigger if consent changes in another tab
    const onStorage = () => setLevel(readConsent());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const open = () => {
      window.localStorage.removeItem(CONSENT_KEY);
      setLevel(null);
    };
    window.addEventListener(QA_EVENTS.OPEN_COOKIE_CONSENT, open);
    return () => window.removeEventListener(QA_EVENTS.OPEN_COOKIE_CONSENT, open);
  }, []);

  if (level !== null) return null;

  const choose = (next: ConsentLevel) => {
    writeConsent(next);
    setLevel(next);
    if (next === 'all') {
      // Attach Sentry Session Replay at runtime rather than reloading — a reload
      // aborts in-flight SIWE handshakes (nonce fetched, signature pending).
      void import('@sentry/react').then((Sentry) => {
        const client = Sentry.getClient();
        if (!client || client.getIntegrationByName?.('Replay')) return;
        Sentry.addIntegration(
          Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false })
        );
      });
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie and tracking preferences"
      className="fixed bottom-0 inset-x-0 z-50 border-t bg-background/95 backdrop-blur px-4 py-4"
    >
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-sm">
        <p className="text-muted-foreground leading-snug">
          We use essential cookies to keep you signed in and remember preferences. With your
          consent, we also use Sentry error tracking and session replay to debug issues. See our{' '}
          <a href="/privacy" className="text-primary underline">
            Privacy Policy
          </a>
          .
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => choose('essential')}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Essential only
          </button>
          <button
            type="button"
            onClick={() => choose('all')}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}

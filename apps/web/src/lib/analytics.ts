/**
 * Product analytics via PostHog.
 *
 * What this gives you (when VITE_POSTHOG_KEY is set):
 *   - Autocaptured pageviews + clicks on every element (no manual instrumentation)
 *   - Session duration: $session_start → $session_end, computed from idle
 *   - Time on page: $pageview → $pageleave per route
 *   - User identity: `identify(uid)` links anonymous sessions to wallet addresses
 *     on SIWE login, stitches their history together across devices
 *   - Session replay (masked): see exactly what a user saw when they hit an issue
 *   - Funnels / retention / cohorts: built in the PostHog UI on top of events
 *
 * Custom events emitted from the app:
 *   - auth:login_started / auth:login_succeeded / auth:login_failed
 *   - generation:queued / generation:admin_blocked
 *   - credits:purchase_started / credits:purchase_completed
 *   - admin:kill_switch_flipped (admin-only)
 *
 * PostHog is loaded lazily — import cost is only paid when the key is set.
 * No key → analytics is a silent no-op everywhere (track() calls are cheap).
 *
 * Privacy:
 *   - Session replay masks inputs by default (`maskAllInputs: true`)
 *   - POST bodies are never captured
 *   - Only wallet addresses (public on-chain identity) are used as user IDs
 *   - See docs/analytics.md for the full privacy posture.
 */

// Minimal PostHog surface we depend on. Typed structurally so this module
// compiles even when `posthog-js` isn't installed (lazy dep, Vite resolves
// at runtime when the env key is set).
type PostHogLike = {
  init: (key: string, opts: Record<string, unknown>) => unknown;
  capture: (event: string, props?: Record<string, unknown>) => void;
  identify: (id: string, props?: Record<string, unknown>) => void;
  reset: () => void;
  debug?: (v: boolean) => void;
};

let posthogPromise: Promise<PostHogLike | null> | null = null;

/** Lazy init — resolves to the PostHog client, or null if disabled. */
function getClient(): Promise<PostHogLike | null> {
  if (posthogPromise) return posthogPromise;

  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) {
    posthogPromise = Promise.resolve(null);
    return posthogPromise;
  }

  posthogPromise = (async () => {
    try {
      const modName = 'posthog-js';
      const mod = (await import(/* @vite-ignore */ modName)) as { default: PostHogLike };
      const posthog = mod.default;
      posthog.init(key, {
        api_host: (import.meta.env.VITE_POSTHOG_HOST as string) ?? 'https://us.i.posthog.com',
        // 2026-01-30 defaults bundle turns on autocapture, pageview/pageleave,
        // session replay with masked inputs, and respect_dnt in one switch.
        defaults: '2026-01-30',
        // Only create person profiles for identified (logged-in wallet) users.
        // Keeps anonymous browsing sessions lightweight + cuts PostHog cost.
        person_profiles: 'identified_only',
        // Extra hardening on top of the defaults — mask anything tagged .ph-mask.
        session_recording: { maskAllInputs: true, maskTextSelector: '.ph-mask' },
        loaded: (ph: PostHogLike) => {
          if (import.meta.env.DEV) {
            ph.debug?.(false);
            // eslint-disable-next-line no-console
            console.log('[analytics] PostHog loaded');
          }
        },
      });
      return posthog;
    } catch {
      // posthog-js not installed — silent disable.
      return null;
    }
  })();

  return posthogPromise;
}

/** Track a custom event. Safe to call before PostHog finishes loading. */
export async function track(event: string, props?: Record<string, unknown>): Promise<void> {
  const client = await getClient();
  client?.capture(event, props);
}

/**
 * Link the current session to a wallet address. Stitches anonymous
 * pre-login activity to the user's identified history.
 */
export async function identifyUser(address: string): Promise<void> {
  const client = await getClient();
  client?.identify(address.toLowerCase(), { wallet: address.toLowerCase() });
}

/** Clear user identity on logout — back to anonymous. */
export async function resetUser(): Promise<void> {
  const client = await getClient();
  client?.reset();
}

/** Initialize on app boot. Idempotent. */
export async function initAnalytics(): Promise<void> {
  await getClient();
}

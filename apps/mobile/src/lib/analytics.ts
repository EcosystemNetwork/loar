/**
 * Product analytics for the React Native mobile app via PostHog.
 *
 * Mirrors the web analytics module (apps/web/src/lib/analytics.ts) so events
 * from both surfaces land in the same PostHog project with consistent event
 * names. Identifying a user with the same wallet address on web + mobile
 * stitches their sessions across devices.
 *
 * What's captured:
 *   - Screen views (use `trackScreen(name)` from expo-router listener)
 *   - Taps on elements (PostHog autocapture for RN is less aggressive than
 *     web; call `track('tap:<label>')` manually on important buttons)
 *   - Session duration: handled automatically by the SDK's lifecycle hooks
 *   - Custom events via `track(event, props)`
 *
 * Gated on EXPO_PUBLIC_POSTHOG_KEY — no key → silent no-op.
 */
import { useEffect } from 'react';

type PostHog = {
  capture: (event: string, props?: Record<string, unknown>) => void;
  identify: (id: string, props?: Record<string, unknown>) => void;
  reset: () => void;
  screen?: (name: string, props?: Record<string, unknown>) => void;
};

let client: PostHog | null = null;
let initPromise: Promise<PostHog | null> | null = null;

async function getClient(): Promise<PostHog | null> {
  if (initPromise) return initPromise;

  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key) {
    initPromise = Promise.resolve(null);
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Runtime-resolved import keeps the SDK out of the JS bundle when the
      // dep isn't installed (e.g. sandbox / dev without posthog-react-native).
      const modName = 'posthog-react-native';
      const mod = await import(/* @ts-ignore */ modName as any);
      const PostHogCtor = mod.default ?? mod.PostHog;
      const instance = new PostHogCtor(key, {
        host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
        captureApplicationLifecycleEvents: true,
        enableSessionReplay: false,
      });
      client = instance as PostHog;
      return client;
    } catch {
      // posthog-react-native not installed or failed to load — silently disable.
      return null;
    }
  })();

  return initPromise;
}

export async function track(event: string, props?: Record<string, unknown>): Promise<void> {
  const c = await getClient();
  c?.capture(event, props);
}

export async function trackScreen(name: string, props?: Record<string, unknown>): Promise<void> {
  const c = await getClient();
  if (c?.screen) c.screen(name, props);
  else c?.capture('$screen', { $screen_name: name, ...props });
}

export async function identifyUser(address: string): Promise<void> {
  const c = await getClient();
  c?.identify(address.toLowerCase(), { wallet: address.toLowerCase() });
}

export async function resetUser(): Promise<void> {
  const c = await getClient();
  c?.reset();
}

export async function initAnalytics(): Promise<void> {
  await getClient();
}

/** Hook: track a screen view on mount. */
export function useScreenView(name: string, props?: Record<string, unknown>) {
  useEffect(() => {
    void trackScreen(name, props);
    // Only fire on name changes — props are context, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}

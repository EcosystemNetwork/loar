/**
 * Server-side product analytics via PostHog.
 *
 * Emits events for the key funnel transitions that only the server can see:
 *   - SIWE verification success/failure (after signature validation)
 *   - Generation queued / admission-gate blocked
 *   - Credits purchased (card / ETH / LOAR)
 *   - Admin actions (kill-switch flip, moderation decisions)
 *   - Universe / content lifecycle (created, published, minted)
 *
 * These stitch into the same PostHog project the web + mobile clients
 * report to, so a single user funnel covers every surface. Identify the
 * user via `captureServerEvent(event, { distinctId: wallet, ... })`.
 *
 * Gated on POSTHOG_API_KEY — no key → silent no-op. Never throws; analytics
 * must not affect user-facing request latency or error rates.
 */

const POSTHOG_KEY = process.env.POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

type PosthogClient = {
  capture: (opts: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }) => void;
  shutdown: () => Promise<void>;
};
type PosthogClientOrNull = PosthogClient | null;

let client: PosthogClientOrNull = null;
let initPromise: Promise<PosthogClientOrNull> | null = null;

function getClient(): Promise<PosthogClientOrNull> {
  if (initPromise) return initPromise;
  if (!POSTHOG_KEY) {
    const p: Promise<PosthogClientOrNull> = Promise.resolve(null);
    initPromise = p;
    return p;
  }

  const p: Promise<PosthogClientOrNull> = (async () => {
    try {
      const modName = 'posthog-node';
      const mod = await import(/* @ts-ignore */ modName as any);
      const PostHog = mod.PostHog ?? mod.default;
      const instance = new PostHog(POSTHOG_KEY, {
        host: POSTHOG_HOST,
        // Keep a short flush interval so ephemeral workers (node cycles during
        // deploys) don't lose the tail of their events.
        flushAt: 20,
        flushInterval: 10_000,
      });
      client = instance as PosthogClient;
      return client;
    } catch {
      // posthog-node not installed or failed to import — silent no-op.
      return null;
    }
  })();
  initPromise = p;
  return p;
}

/**
 * Capture a server-side event. Non-blocking — returns immediately,
 * PostHog batches and flushes in the background.
 *
 *   captureServerEvent('generation:queued', {
 *     distinctId: ctx.user.uid,     // wallet address
 *     provider: 'fal',
 *     kind: 'video',
 *     credits: 250,
 *   });
 */
export async function captureServerEvent(
  event: string,
  opts: { distinctId: string; [key: string]: unknown }
): Promise<void> {
  const { distinctId, ...rest } = opts;
  if (!distinctId) return;
  try {
    const c = await getClient();
    c?.capture({ distinctId: String(distinctId).toLowerCase(), event, properties: rest });
  } catch {
    // Analytics must never impact the request path.
  }
}

/** Flush pending events. Call from SIGTERM handler so the last ~10s of data survives a deploy. */
export async function shutdownAnalytics(): Promise<void> {
  try {
    const c = await getClient();
    await c?.shutdown();
  } catch {
    // Best-effort.
  }
}

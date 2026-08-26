/**
 * Resolve which API key to use for a given (user, provider) request.
 *
 * BYOK-only: if the user has an enabled key for this provider, return it
 * with `source: 'byok'`. Otherwise throw `NoKeyAvailableError` — there is
 * no server-pool fallback, so every dispatch spends the requesting user's
 * own quota (retired in favor of the platform-key fallback this module
 * used to offer).
 *
 * Callers should not cache the resolved key — every dispatch should
 * re-resolve so disabled/rotated keys are picked up immediately.
 */
import { isKnownProvider, PROVIDER_REGISTRY } from './registry';
import { exists, loadPlaintext } from './store';
import { UnknownProviderError, type ProviderId } from './types';

export interface ResolvedKey {
  apiKey: string;
  source: 'byok' | 'server';
  /** Set when source='byok' — for audit logging. */
  keyFingerprint?: string;
  provider: ProviderId;
}

export class NoKeyAvailableError extends Error {
  constructor(public provider: ProviderId) {
    super(
      `No key available for provider '${provider}' — user has not added a BYOK key and the server pool is empty.`
    );
    this.name = 'NoKeyAvailableError';
  }
}

export async function resolveProviderKey(userId: string, provider: string): Promise<ResolvedKey> {
  if (!isKnownProvider(provider)) throw new UnknownProviderError(provider);

  // BYOK only — the server-pool env-var fallback was retired so every
  // dispatch spends the requesting user's own quota. `serverPoolAvailable`
  // below still reports whether an env key is configured (ops/health
  // display only); it is never used to authorize a dispatch.
  if (await exists(userId, provider)) {
    try {
      const apiKey = await loadPlaintext(userId, provider);
      return { apiKey, source: 'byok', provider };
    } catch {
      // Disabled/corrupt BYOK key — treat the same as "no BYOK key", not
      // an env fallback.
    }
  }

  throw new NoKeyAvailableError(provider);
}

/**
 * Synchronous check — useful for capability-aware UIs. Returns true if
 * the caller can dispatch to this provider without throwing
 * `NoKeyAvailableError`, considering only the server pool. To check for
 * BYOK availability, call `exists()` from the store directly.
 */
export function serverPoolAvailable(provider: ProviderId): boolean {
  const envVar = PROVIDER_REGISTRY[provider].serverPoolEnvVar;
  const v = process.env[envVar];
  return !!(v && v.length > 0);
}

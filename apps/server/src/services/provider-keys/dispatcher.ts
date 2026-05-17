/**
 * Resolve which API key to use for a given (user, provider) request.
 *
 * Resolution order:
 *   1. If the user has an enabled BYOK key for this provider, return it
 *      with `source: 'byok'`.
 *   2. Else if the server pool has an env-configured key, return it with
 *      `source: 'server'`.
 *   3. Else throw — neither path is available, the caller cannot dispatch.
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
  const entry = PROVIDER_REGISTRY[provider];

  // BYOK first
  if (await exists(userId, provider)) {
    try {
      const apiKey = await loadPlaintext(userId, provider);
      return { apiKey, source: 'byok', provider };
    } catch {
      // Falls through to server pool — disabled keys throw NotFound and
      // we treat that as "no BYOK", not an error.
    }
  }

  // Server pool fallback
  const serverKey = process.env[entry.serverPoolEnvVar];
  if (serverKey && serverKey.length > 0) {
    return { apiKey: serverKey, source: 'server', provider };
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

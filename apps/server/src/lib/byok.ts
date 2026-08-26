/**
 * BYOK key resolver — thin facade that returns the plaintext key string for
 * a (user, provider) pair, or `undefined` if the user has no BYOK key on
 * file for that provider.
 *
 * BYOK-only: there is no server env-configured pool fallback here (the
 * env-var fallback was retired — every dispatch now spends the requesting
 * user's own quota). A missing/anonymous `uid` or a missing key both
 * resolve to `undefined`; callers already treat that as "cannot dispatch"
 * (see the `if (!apiKey) …` guard at every call site).
 *
 * Backed by `services/provider-keys/dispatcher.ts`. The legacy `userSecrets`
 * collection is retired; this facade preserves the historical signature so
 * the small number of existing callers (`canon-check`, `zai.routes`,
 * `wikia`, `editJobs/dispatchers`) don't have to learn the richer
 * `ResolvedKey` shape.
 *
 * Usage:
 *
 *   const apiKey = await resolveProviderKey(ctx.userId, 'fal');
 *   if (!apiKey) throw new TRPCError({ code: 'FORBIDDEN', message: '…add a fal.ai key…' });
 *   await falService.generateImage({ ...input, apiKey });
 *
 * For dispatch metadata (`source: 'byok'`, fingerprint), import
 * `resolveProviderKey` from `services/provider-keys` instead.
 */
import {
  resolveProviderKey as resolveResolvedKey,
  NoKeyAvailableError,
  isKnownProvider,
} from '../services/provider-keys';
import type { ProviderId } from '../services/provider-keys/types';

/**
 * Mirrors `ProviderId` from `provider-keys/types`. Kept as a separate
 * export so historic callers can continue to import `SecretProvider`
 * from `lib/byok` without dragging in the provider-keys internals.
 */
export type SecretProvider = ProviderId;

export async function resolveProviderKey(
  uid: string | undefined | null,
  provider: SecretProvider
): Promise<string | undefined> {
  if (!isKnownProvider(provider)) return undefined;
  if (!uid) return undefined;
  try {
    const { apiKey } = await resolveResolvedKey(uid, provider);
    return apiKey;
  } catch (err) {
    // NoKeyAvailableError means no BYOK key on file — expected, not a bug.
    // Any other error (Firestore down, decrypt failure) is also treated as
    // "cannot dispatch" rather than silently reading a platform env key.
    if (!(err instanceof NoKeyAvailableError)) {
      console.error(`[byok] resolveProviderKey(${provider}) failed unexpectedly:`, err);
    }
    return undefined;
  }
}

/**
 * BYOK key resolver — thin facade that returns the plaintext key string for
 * a (user, provider) pair, or `undefined` if neither a user-supplied BYOK
 * key nor the server's env-configured pool key is available.
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
 *   await falService.generateImage({ ...input, apiKey });
 *
 * For dispatch metadata (`source: 'byok' | 'server'`, fingerprint), import
 * `resolveProviderKey` from `services/provider-keys` instead.
 */
import {
  resolveProviderKey as resolveResolvedKey,
  NoKeyAvailableError,
  isKnownProvider,
} from '../services/provider-keys';

export type SecretProvider =
  | 'bytedance'
  | 'zai'
  | 'openai'
  | 'google'
  | 'fal'
  | 'elevenlabs'
  | 'meshy'
  | 'tripo';

const ENV_VAR_BY_PROVIDER: Record<SecretProvider, string> = {
  bytedance: 'BYTEDANCE_API_KEY',
  zai: 'ZAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  fal: 'FAL_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  meshy: 'MESHY_API_KEY',
  tripo: 'TRIPO_API_KEY',
};

export async function resolveProviderKey(
  uid: string | undefined | null,
  provider: SecretProvider
): Promise<string | undefined> {
  if (!isKnownProvider(provider)) return undefined;
  if (uid) {
    try {
      const { apiKey } = await resolveResolvedKey(uid, provider);
      return apiKey;
    } catch (err) {
      // NoKeyAvailable just means no BYOK key + no env pool — fall through
      // to direct env read below. Anything else (Firestore down etc.) we
      // still try env so anonymous service paths keep working.
      if (!(err instanceof NoKeyAvailableError)) {
        // Best-effort fallthrough — never blow up the caller.
      }
    }
  }
  const envKey = process.env[ENV_VAR_BY_PROVIDER[provider]]?.trim();
  return envKey || undefined;
}

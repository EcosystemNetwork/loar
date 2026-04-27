/**
 * BYOK key resolver — returns a user's stored API key for a given provider,
 * falling back to the platform's env-var key if the user hasn't supplied one.
 *
 * Use at every external-API call site:
 *
 *   const apiKey = await resolveProviderKey(ctx.userId, 'fal');
 *   await falService.generateImage({ ...input, apiKey });
 *
 * Returns `undefined` when neither a user key nor an env key is set — caller
 * decides whether that's a hard error or a graceful no-op.
 */
import { getUserSecret, type SecretProvider } from '../services/userSecrets';

const ENV_VAR_BY_PROVIDER: Record<SecretProvider, string> = {
  bytedance: 'BYTEDANCE_API_KEY',
  zai: 'ZAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  fal: 'FAL_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  meshy: 'MESHY_API_KEY',
};

export async function resolveProviderKey(
  uid: string | undefined | null,
  provider: SecretProvider
): Promise<string | undefined> {
  if (uid) {
    const userKey = await getUserSecret(uid, provider);
    if (userKey) return userKey;
  }
  const envVar = ENV_VAR_BY_PROVIDER[provider];
  const envKey = process.env[envVar]?.trim();
  return envKey || undefined;
}

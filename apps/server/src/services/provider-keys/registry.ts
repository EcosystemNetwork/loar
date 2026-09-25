/**
 * Provider registry — the closed set of providers supported by the
 * BYOK system. Each entry carries metadata for the UI plus a `testKey`
 * function that performs a cheap call to verify a user-supplied key
 * before we persist it.
 *
 * Test endpoints are deliberately the smallest possible call on each
 * provider's API — usually a "list models" or "get balance" route. No
 * generation, no audio upload.
 */
import {
  KeyVerificationUnavailableError,
  type ProviderId,
  type ProviderRegistryEntry,
} from './types';

/**
 * Shared key probe. Three outcomes, deliberately distinct:
 *   - resolves `false` → the provider rejected the key (`invalidStatuses`).
 *   - resolves `true`  → auth passed. Any other status counts (200, a 404 from
 *     a made-up resource id, a 429 rate limit — a rate-limited key is a *valid*
 *     key), because we only care whether authentication succeeded.
 *   - throws `KeyVerificationUnavailableError` → we couldn't tell (network
 *     error, timeout, provider 5xx). Never conflated with "rejected", and never
 *     silently treated as valid.
 */
async function probeKey(
  provider: ProviderId,
  url: string,
  headers: Record<string, string>,
  invalidStatuses: number[] = [401, 403]
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new KeyVerificationUnavailableError(provider);
  }
  if (invalidStatuses.includes(res.status)) return false;
  if (res.status >= 500) throw new KeyVerificationUnavailableError(provider);
  return true;
}

// FAL doesn't expose a dedicated whoami; the public-models list works
// unauthenticated, so we hit the queue status of a known model with the auth
// header — invalid keys return 401, the made-up request id returns 404.
const testFalKey = (key: string) =>
  probeKey('fal', 'https://queue.fal.run/fal-ai/whisper/requests/__health', {
    Authorization: `Key ${key}`,
  });

const testAssemblyAIKey = (key: string) =>
  probeKey('assemblyai', 'https://api.assemblyai.com/v2/transcript', { Authorization: key });

const testDeepgramKey = (key: string) =>
  probeKey('deepgram', 'https://api.deepgram.com/v1/projects', { Authorization: `Token ${key}` });

const testGroqKey = (key: string) =>
  probeKey('groq', 'https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${key}` });

const testElevenLabsKey = (key: string) =>
  probeKey('elevenlabs', 'https://api.elevenlabs.io/v1/user', { 'xi-api-key': key });

const testBytedanceKey = (key: string) =>
  probeKey('bytedance', 'https://ark.cn-beijing.volces.com/api/v3/models', {
    Authorization: `Bearer ${key}`,
  });

const testZaiKey = (key: string) =>
  probeKey('zai', 'https://open.bigmodel.cn/api/paas/v4/models', {
    Authorization: `Bearer ${key}`,
  });

const testOpenAIKey = (key: string) =>
  probeKey('openai', 'https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` });

// Key goes in the `x-goog-api-key` header, NOT the URL query string — URL keys
// land in load-balancer access logs / outbound proxy logs. Google answers a bad
// key with 400 (API_KEY_INVALID) as well as 401/403.
const testGoogleKey = (key: string) =>
  probeKey(
    'google',
    'https://generativelanguage.googleapis.com/v1beta/models',
    { 'x-goog-api-key': key },
    [400, 401, 403]
  );

const testMeshyKey = (key: string) =>
  probeKey('meshy', 'https://api.meshy.ai/v2/text-to-3d?page_size=1', {
    Authorization: `Bearer ${key}`,
  });

// MiniMax's lightest reachable endpoint — files list.
const testMiniMaxKey = (key: string) =>
  probeKey('minimax', 'https://api.minimaxi.chat/v1/files/list', {
    Authorization: `Bearer ${key}`,
  });

// Tripo's lightest reachable endpoint — account balance (OpenAPI v3).
const testTripoKey = (key: string) =>
  probeKey('tripo', 'https://openapi.tripo3d.ai/v3/account/balance', {
    Authorization: `Bearer ${key}`,
  });

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderRegistryEntry> = {
  fal: {
    id: 'fal',
    displayName: 'FAL.ai',
    apiKeyDocsUrl: 'https://fal.ai/dashboard/keys',
    serverPoolEnvVar: 'FAL_KEY',
    testKey: testFalKey,
  },
  assemblyai: {
    id: 'assemblyai',
    displayName: 'AssemblyAI',
    apiKeyDocsUrl: 'https://www.assemblyai.com/app/account',
    serverPoolEnvVar: 'ASSEMBLYAI_SERVER_API_KEY',
    testKey: testAssemblyAIKey,
  },
  deepgram: {
    id: 'deepgram',
    displayName: 'Deepgram',
    apiKeyDocsUrl: 'https://console.deepgram.com/project',
    serverPoolEnvVar: 'DEEPGRAM_SERVER_API_KEY',
    testKey: testDeepgramKey,
  },
  groq: {
    id: 'groq',
    displayName: 'Groq',
    apiKeyDocsUrl: 'https://console.groq.com/keys',
    serverPoolEnvVar: 'GROQ_SERVER_API_KEY',
    testKey: testGroqKey,
  },
  elevenlabs: {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    apiKeyDocsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    serverPoolEnvVar: 'ELEVENLABS_API_KEY',
    testKey: testElevenLabsKey,
  },
  bytedance: {
    id: 'bytedance',
    displayName: 'ByteDance ModelArk',
    apiKeyDocsUrl: 'https://docs.byteplus.com/en/docs/ModelArk/',
    serverPoolEnvVar: 'BYTEDANCE_API_KEY',
    testKey: testBytedanceKey,
  },
  zai: {
    id: 'zai',
    displayName: 'Z.AI (GLM)',
    apiKeyDocsUrl: 'https://docs.z.ai/llms.txt',
    serverPoolEnvVar: 'ZAI_API_KEY',
    testKey: testZaiKey,
  },
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    apiKeyDocsUrl: 'https://platform.openai.com/api-keys',
    serverPoolEnvVar: 'OPENAI_API_KEY',
    testKey: testOpenAIKey,
  },
  google: {
    id: 'google',
    displayName: 'Google AI (Imagen + Gemini)',
    apiKeyDocsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    serverPoolEnvVar: 'GOOGLE_API_KEY',
    testKey: testGoogleKey,
  },
  meshy: {
    id: 'meshy',
    displayName: 'Meshy',
    apiKeyDocsUrl: 'https://www.meshy.ai/api-keys',
    serverPoolEnvVar: 'MESHY_API_KEY',
    testKey: testMeshyKey,
  },
  tripo: {
    id: 'tripo',
    displayName: 'Tripo3D',
    apiKeyDocsUrl: 'https://platform.tripo3d.ai/api-keys',
    serverPoolEnvVar: 'TRIPO_API_KEY',
    testKey: testTripoKey,
  },
  minimax: {
    id: 'minimax',
    displayName: 'MiniMax (Hailuo)',
    apiKeyDocsUrl:
      'https://platform.minimaxi.com/document/Fast%20access?key=66719005a427f0c8a5701643',
    serverPoolEnvVar: 'MINIMAX_API_KEY',
    testKey: testMiniMaxKey,
  },
};

export const KNOWN_PROVIDERS: ProviderId[] = Object.keys(PROVIDER_REGISTRY) as ProviderId[];

export function isKnownProvider(p: string): p is ProviderId {
  return p in PROVIDER_REGISTRY;
}

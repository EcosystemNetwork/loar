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
import type { ProviderId, ProviderRegistryEntry } from './types';

async function testFalKey(key: string): Promise<boolean> {
  // FAL doesn't expose a dedicated whoami; the public-models list works
  // unauthenticated, so we instead hit the queue status of a known
  // model with the auth header — invalid keys return 401.
  const res = await fetch('https://queue.fal.run/fal-ai/whisper/requests/__health', {
    method: 'GET',
    headers: { Authorization: `Key ${key}` },
    signal: AbortSignal.timeout(8_000),
  });
  // 401/403 = bad key. Anything else (including 404 from the made-up
  // request id) means auth passed.
  if (res.status === 401 || res.status === 403) return false;
  return true;
}

async function testAssemblyAIKey(key: string): Promise<boolean> {
  const res = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'GET',
    headers: { Authorization: key },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401) return false;
  return res.ok;
}

async function testDeepgramKey(key: string): Promise<boolean> {
  const res = await fetch('https://api.deepgram.com/v1/projects', {
    method: 'GET',
    headers: { Authorization: `Token ${key}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) return false;
  return res.ok;
}

async function testGroqKey(key: string): Promise<boolean> {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) return false;
  return res.ok;
}

async function testElevenLabsKey(key: string): Promise<boolean> {
  const res = await fetch('https://api.elevenlabs.io/v1/user', {
    method: 'GET',
    headers: { 'xi-api-key': key },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) return false;
  return res.ok;
}

async function testBytedanceKey(key: string): Promise<boolean> {
  const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) return false;
  return true;
}

async function testZaiKey(key: string): Promise<boolean> {
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) return false;
  return true;
}

async function testOpenAIKey(key: string): Promise<boolean> {
  const res = await fetch('https://api.openai.com/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) return false;
  return res.ok;
}

async function testGoogleKey(key: string): Promise<boolean> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    { method: 'GET', signal: AbortSignal.timeout(8_000) }
  );
  if (res.status === 401 || res.status === 403 || res.status === 400) return false;
  return res.ok;
}

async function testMeshyKey(key: string): Promise<boolean> {
  const res = await fetch('https://api.meshy.ai/v2/text-to-3d?page_size=1', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) return false;
  return true;
}

async function testTripoKey(key: string): Promise<boolean> {
  // Tripo's lightest reachable endpoint — account balance. 200 == valid,
  // 401/403 == bad key, anything else we treat as transient (don't reject).
  const res = await fetch('https://api.tripo3d.ai/v2/openapi/user/balance', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) return false;
  return true;
}

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
};

export const KNOWN_PROVIDERS: ProviderId[] = Object.keys(PROVIDER_REGISTRY) as ProviderId[];

export function isKnownProvider(p: string): p is ProviderId {
  return p in PROVIDER_REGISTRY;
}

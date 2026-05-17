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
};

export const KNOWN_PROVIDERS: ProviderId[] = Object.keys(PROVIDER_REGISTRY) as ProviderId[];

export function isKnownProvider(p: string): p is ProviderId {
  return p in PROVIDER_REGISTRY;
}

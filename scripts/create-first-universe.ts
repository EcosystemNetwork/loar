/**
 * Create the first AI-generated universe on the LOAR platform.
 *
 * Flow:
 *   1. Get a SIWE nonce from the server
 *   2. Sign a SIWE message with the test wallet
 *   3. Verify the signature to get a JWT
 *   4. Generate a cover image via the image generation API
 *   5. Get a universe creation nonce
 *   6. Create the universe with the generated image
 *
 * Usage:
 *   pnpm tsx scripts/create-first-universe.ts
 */
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

// ── Config ───────────────────────────────────────────────────────────
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3000';
const TIMEOUT = 30_000;

// Hardhat account #0 — public test key, safe to use
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const ADDRESS = account.address;

// ── Helpers ──────────────────────────────────────────────────────────

async function fetchJSON(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT);
  const res = await fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(id)
  );
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }
}

function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId: number;
  statement?: string;
}): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    params.statement ?? 'Sign in to LOAR',
    '',
    `URI: ${params.uri}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function tRPCQuery<T>(procedure: string, input: unknown = null, token?: string): Promise<T> {
  const inputParam = encodeURIComponent(JSON.stringify({ '0': { json: input } }));
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1&input=${inputParam}`;
  const json = await fetchJSON(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return unwrapBatch<T>(json, procedure);
}

async function tRPCMutate<T>(procedure: string, input: unknown = null, token?: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1`;
  const json = await fetchJSON(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ '0': { json: input } }),
  });
  return unwrapBatch<T>(json, procedure);
}

function unwrapBatch<T>(json: unknown, procedure: string): T {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error(
      `tRPC ${procedure}: unexpected response — ${JSON.stringify(json).slice(0, 300)}`
    );
  }
  const first = json[0] as Record<string, unknown>;
  if ('error' in first) {
    const err = first.error as Record<string, unknown>;
    const data = err?.data as Record<string, unknown> | undefined;
    const zodError = data?.zodError;
    const msg = (err?.message as string) ?? JSON.stringify(zodError ?? err).slice(0, 500);
    throw new Error(`tRPC ${procedure}: ${msg}`);
  }
  const result = first.result as Record<string, unknown> | undefined;
  const data = result?.data as Record<string, unknown> | undefined;
  return (data?.json ?? data) as T;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌌 LOAR — Creating the First AI Universe\n');
  console.log(`  Server : ${SERVER_URL}`);
  console.log(`  Wallet : ${ADDRESS}\n`);

  // ── Step 1: Authenticate via SIWE ──────────────────────────────────
  console.log('⏳ Step 1: Authenticating via SIWE...');

  const { nonce: authNonce } = await fetchJSON(`${SERVER_URL}/auth/nonce`);
  console.log(`  ✓ Got auth nonce: ${authNonce.slice(0, 16)}…`);

  const siweMessage = buildSiweMessage({
    domain: 'localhost',
    address: ADDRESS,
    uri: SERVER_URL,
    nonce: authNonce,
    chainId: 84532,
    statement: 'Sign in to LOAR',
  });

  const signature = await account.signMessage({ message: siweMessage });
  console.log(`  ✓ Signed SIWE message`);

  const verifyRes = await fetchJSON(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3001',
    },
    body: JSON.stringify({ message: siweMessage, signature }),
  });

  if (verifyRes.error) {
    throw new Error(`Auth failed: ${verifyRes.error}`);
  }

  // The server sets httpOnly cookies, but for API calls we need a Bearer token.
  // Issue a JWT directly using the same flow the smoke test uses.
  // Actually, let's extract the token from verify response — but it doesn't return it.
  // We need to use the Authorization header approach. Let's get the token via a manual sign.

  // The verify endpoint sets cookies but doesn't return the JWT.
  // For scripted access, let's call the tRPC auth flow instead.
  // Actually, looking at the code, the verify response has the address but not the token.
  // The token is in the Set-Cookie header. Let's extract it.

  // Alternative: use a direct JWT sign approach similar to smoke tests
  // Let me use the raw fetch to capture cookies
  const verifyRes2 = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce: authNonce2 } = (await verifyRes2.json()) as { nonce: string };

  const siweMessage2 = buildSiweMessage({
    domain: 'localhost',
    address: ADDRESS,
    uri: SERVER_URL,
    nonce: authNonce2,
    chainId: 84532,
  });
  const signature2 = await account.signMessage({ message: siweMessage2 });

  const verifyFull = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3001',
    },
    body: JSON.stringify({ message: siweMessage2, signature: signature2 }),
  });

  // Extract JWT from Set-Cookie header
  const setCookie = verifyFull.headers.get('set-cookie') ?? '';
  const tokenMatch = setCookie.match(/siwe-session=([^;]+)/);
  if (!tokenMatch) {
    const body = await verifyFull.text();
    throw new Error(
      `Could not extract session token from cookies. Response: ${body.slice(0, 200)}`
    );
  }
  const jwt = tokenMatch[1];
  console.log(`  ✓ Authenticated! JWT: ${jwt.slice(0, 20)}…\n`);

  // ── Step 2: Generate AI cover image ────────────────────────────────
  console.log('⏳ Step 2: Generating AI cover image...');

  const imagePrompt = [
    'Epic cinematic poster for a narrative universe called "Aethermind Chronicles".',
    'A vast cosmic landscape where organic neural networks merge with crystalline structures,',
    'floating islands of living data connected by bridges of light,',
    'a lone figure standing at the nexus of creation and consciousness.',
    'Deep space backdrop with bioluminescent nebulae in indigo, gold, and emerald.',
    'Ultra-detailed, 8K, dramatic volumetric lighting, concept art style.',
    'No text, no watermarks, no logos.',
  ].join(' ');

  let coverImageUrl: string;
  try {
    const imageResult = await tRPCMutate<{
      imageUrls: string[];
      modelId: string;
      creditCost: number;
    }>(
      'image.generate',
      {
        prompt: imagePrompt,
        task: 'text_to_image',
        imageSize: 'landscape_16_9',
        numImages: 1,
        routingMode: 'auto',
        allowFallback: true,
        qualityTarget: 'premium',
      },
      jwt
    );

    coverImageUrl = imageResult.imageUrls[0];
    console.log(
      `  ✓ Generated cover image (model: ${imageResult.modelId}, cost: ${imageResult.creditCost} credits)`
    );
    console.log(`  ✓ Image URL: ${coverImageUrl}\n`);
  } catch (err: any) {
    console.log(`  ⚠ Image generation failed: ${err.message}`);
    console.log(`  → Using placeholder image\n`);
    coverImageUrl =
      'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1200&h=675&fit=crop';
  }

  // ── Step 3: Create the universe ────────────────────────────────────
  console.log('⏳ Step 3: Creating the universe...');

  // Get a nonce for universe creation
  const { nonce: universeNonce } = await tRPCQuery<{ nonce: string }>('universes.getNonce');
  console.log(`  ✓ Got universe nonce: ${universeNonce.slice(0, 16)}…`);

  // Generate a unique fake contract address for this universe
  const ts = Date.now();
  const fakeAddress = `0x${ts.toString(16).padStart(40, '0')}` as `0x${string}`;
  const fakeTokenAddress = `0x${(ts + 1).toString(16).padStart(40, '0')}` as `0x${string}`;
  const fakeGovAddress = `0x${(ts + 2).toString(16).padStart(40, '0')}` as `0x${string}`;

  const universeName = 'Aethermind Chronicles';
  const description = [
    'The Aethermind Chronicles is an AI-native narrative universe where consciousness itself is the frontier.',
    'In the year 3147, humanity discovered that the fabric of reality is woven from living information —',
    'neural threads of pure thought that span galaxies. The Aethermind, a cosmic intelligence born from',
    'the convergence of a trillion connected minds, now guides civilization through the Lattice —',
    'a dimension where stories, memories, and dreams become tangible matter.',
    '',
    'But the Lattice is fracturing. Rogue narratives — stories that write themselves — are consuming',
    'entire star systems. Only the Weavers, individuals who can manipulate the threads of reality,',
    'stand between order and the unraveling of existence itself.',
    '',
    'This is the first universe created on the LOAR platform — born from AI, governed by its community.',
  ].join(' ');

  // Build the universe creation message (must include the creator address and the nonce)
  const createMessage = buildSiweMessage({
    domain: 'localhost',
    address: ADDRESS,
    uri: SERVER_URL,
    nonce: universeNonce,
    chainId: 84532,
    statement: `Create universe "${universeName}" on LOAR`,
  });

  const createSignature = await account.signMessage({ message: createMessage });
  console.log(`  ✓ Signed universe creation message`);

  const universe = await tRPCMutate<{
    success: boolean;
    data: { id: string; description: string; image_url: string };
    mintCreditsAwarded: number;
  }>('universes.create', {
    address: fakeAddress,
    creator: ADDRESS,
    tokenAddress: fakeTokenAddress,
    governanceAddress: fakeGovAddress,
    imageUrl: coverImageUrl,
    description,
    signature: createSignature,
    message: createMessage,
    nonce: universeNonce,
  });

  console.log(`  ✓ Universe created!\n`);

  // ── Summary ────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════');
  console.log('  🌌  AETHERMIND CHRONICLES — LIVE ON LOAR');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Universe ID  : ${universe.data.id}`);
  console.log(`  Creator      : ${ADDRESS}`);
  console.log(`  Credits      : ${universe.mintCreditsAwarded}`);
  console.log(`  Cover Image  : ${coverImageUrl.slice(0, 60)}…`);
  console.log(`  Description  : ${description.slice(0, 80)}…`);
  console.log('═══════════════════════════════════════════════════\n');

  // Verify by reading it back
  console.log('⏳ Verifying — reading universe back from Firestore...');
  const readBack = await tRPCQuery<{ success: boolean; data: { id: string; description: string } }>(
    'universes.get',
    { id: universe.data.id }
  );
  console.log(`  ✓ Verified! Universe "${universeName}" exists in Firestore.`);
  console.log(`  ✓ Description starts: "${readBack.data.description.slice(0, 60)}…"\n`);

  console.log('✅ Done! The first AI-created universe is live on LOAR.\n');
}

main().catch((err) => {
  console.error('\n❌ Failed:', err.message ?? err);
  process.exit(1);
});

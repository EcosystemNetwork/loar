#!/usr/bin/env npx tsx
/**
 * Sandbox E2E Flow Test
 *
 * Tests the full sandbox pipeline:
 *   1. Auth — SIWE nonce → sign → verify → JWT
 *   2. Video generation — Seedance 2.0 text-to-video (FREE, 0 credits)
 *   3. Save draft — persist to Firestore
 *   4. Load drafts — verify draft appears
 *   5. Promote draft — promote to gallery
 *   6. Verify — check promoted status
 *
 * Usage:
 *   npx tsx scripts/test-sandbox-flow.ts
 *   npx tsx scripts/test-sandbox-flow.ts --skip-generation   # skip AI calls, test CRUD only
 */

import { privateKeyToAccount } from 'viem/accounts';

// ── Config ──────────────────────────────────────────────────────────────────

const SERVER = process.env.SERVER_URL?.replace(/\/$/, '') || 'http://localhost:3000';
const TIMEOUT = 300_000; // 5 min — video gen can take a while
const SKIP_GEN = process.argv.includes('--skip-generation');

const WALLET = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
};

const TEST_PROMPT =
  'Three anime warriors standing on a neon-lit rooftop at night, wind blowing through their hair, cyberpunk city skyline behind them, cinematic dramatic lighting, detailed anime style';

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(step: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${step.padEnd(16)} ${msg}`);
}

function fail(step: string, err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n  FAIL  ${step}: ${msg}\n`);
  process.exit(1);
}

async function fetchJSON(url: string, init: RequestInit = {}): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(id);
  }
}

async function trpcMutate(procedure: string, input: unknown, token: string): Promise<any> {
  const json = await fetchJSON(`${SERVER}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ '0': input }),
  });
  if (!Array.isArray(json) || !json[0])
    throw new Error(`Bad response: ${JSON.stringify(json).slice(0, 200)}`);
  if (json[0].error) {
    const e =
      json[0].error?.json?.message || json[0].error?.message || JSON.stringify(json[0].error);
    throw new Error(e);
  }
  return json[0].result?.data;
}

async function trpcQuery(procedure: string, input: unknown, token: string): Promise<any> {
  const inputParam = encodeURIComponent(JSON.stringify({ '0': input }));
  const json = await fetchJSON(`${SERVER}/trpc/${procedure}?batch=1&input=${inputParam}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!Array.isArray(json) || !json[0])
    throw new Error(`Bad response: ${JSON.stringify(json).slice(0, 200)}`);
  if (json[0].error) {
    const e =
      json[0].error?.json?.message || json[0].error?.message || JSON.stringify(json[0].error);
    throw new Error(e);
  }
  return json[0].result?.data;
}

function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId: number;
}): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${params.uri}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  LOAR Sandbox E2E Flow Test');
  console.log('  ═════════════════════════════════════════\n');

  // ── Step 1: Auth ──────────────────────────────────────────────────────
  log('AUTH', 'Fetching nonce...');
  const nonceRes = await fetchJSON(`${SERVER}/auth/nonce`);
  const nonce = nonceRes?.nonce;
  if (!nonce) fail('AUTH', 'No nonce returned');
  log('AUTH', `Nonce: ${nonce.slice(0, 8)}...`);

  const account = privateKeyToAccount(WALLET.privateKey);
  const message = buildSiweMessage({
    domain: 'localhost',
    address: WALLET.address,
    uri: SERVER,
    nonce,
    chainId: 84532,
  });
  const signature = await account.signMessage({ message });
  log('AUTH', `Signed: ${signature.slice(0, 12)}...`);

  const verifyRaw = await fetch(`${SERVER}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRaw.ok) {
    const body = await verifyRaw.text();
    fail('AUTH', `Verify HTTP ${verifyRaw.status}: ${body}`);
  }
  const setCookieHeaders = verifyRaw.headers.getSetCookie?.() || [];
  const siweSessionCookie = setCookieHeaders.find((c) => c.startsWith('siwe-session='));
  const token = siweSessionCookie?.split('=')[1]?.split(';')[0] || '';
  if (!token || token.split('.').length !== 3) {
    fail('AUTH', `No JWT in Set-Cookie. Got: ${setCookieHeaders.join(', ').slice(0, 100)}`);
  }
  log('AUTH', `JWT acquired (${token.length} chars)`);

  // ── Step 2: Video Generation — Seedance 2.0 T2V (FREE) ───────────────
  let videoUrl: string | null = null;

  if (SKIP_GEN) {
    log('VIDEO', 'SKIPPED (--skip-generation)');
    videoUrl = 'https://httpbin.org/image/jpeg'; // placeholder for CRUD tests
  } else {
    log('VIDEO', 'Generating video with Seedance 2.0 text-to-video (0 credits)...');
    log('VIDEO', `Prompt: "${TEST_PROMPT.slice(0, 60)}..."`);
    const startVid = Date.now();
    try {
      // Use the unified generation.generate endpoint (respects model registry pricing)
      const vidResult = await trpcMutate(
        'generation.generate',
        {
          prompt: TEST_PROMPT,
          mode: 'text_to_video',
          routingMode: 'manual',
          selectedModelId: 'seedance2-t2v',
          durationSec: 5,
          resolution: '720p',
          aspectRatio: '16:9',
          audio: true,
        },
        token
      );
      videoUrl = vidResult?.videoUrl || null;
      const elapsed = ((Date.now() - startVid) / 1000).toFixed(1);
      if (videoUrl) {
        log('VIDEO', `Generated in ${elapsed}s`);
        log('VIDEO', `URL: ${videoUrl.slice(0, 80)}...`);
      } else {
        log('VIDEO', `Response: ${JSON.stringify(vidResult).slice(0, 300)}`);
        fail('VIDEO', 'No video URL returned');
      }
    } catch (err) {
      fail('VIDEO', err);
    }
  }

  // ── Step 3: Save Draft ────────────────────────────────────────────────
  log('SAVE', 'Saving draft...');
  let draftId: string;
  try {
    const saveResult = await trpcMutate(
      'sandbox.saveDraft',
      {
        title: 'Sandbox E2E Test — Anime Warriors',
        prompt: TEST_PROMPT,
        videoUrl: videoUrl || undefined,
        model: 'seedance',
        tags: ['test', 'anime', 'cyberpunk'],
      },
      token
    );
    draftId = saveResult?.id;
    if (!draftId) fail('SAVE', 'No draft ID returned');
    log('SAVE', `Draft saved: ${draftId}`);
  } catch (err) {
    fail('SAVE', err);
  }

  // ── Step 4: Load Drafts ───────────────────────────────────────────────
  log('LOAD', 'Loading drafts...');
  try {
    const drafts = await trpcQuery('sandbox.myDrafts', null, token);
    const found = Array.isArray(drafts) && drafts.some((d: any) => d.id === draftId);
    log('LOAD', `${drafts?.length ?? 0} drafts found, test draft ${found ? 'PRESENT' : 'MISSING'}`);
    if (!found) fail('LOAD', 'Saved draft not found in myDrafts');
  } catch (err) {
    fail('LOAD', err);
  }

  // ── Step 5: Promote to Gallery ────────────────────────────────────────
  log('PROMOTE', 'Promoting draft to gallery...');
  let contentId: string | null = null;
  try {
    const promoteResult = await trpcMutate(
      'sandbox.promoteToUniverse',
      {
        draftId,
        classification: 'original',
        visibility: 'public',
      },
      token
    );
    contentId = promoteResult?.contentId || null;
    log('PROMOTE', `Promoted -> content ${contentId}`);
  } catch (err) {
    fail('PROMOTE', err);
  }

  // ── Step 6: Verify promoted status ────────────────────────────────────
  log('VERIFY', 'Checking draft status...');
  try {
    const draft = await trpcQuery('sandbox.getDraft', { id: draftId }, token);
    const status = draft?.status;
    log('VERIFY', `Draft status: ${status}`);
    if (status !== 'promoted') fail('VERIFY', `Expected 'promoted', got '${status}'`);
  } catch (err) {
    fail('VERIFY', err);
  }

  // ── Done ──────────────────────────────────────────────────────────────
  console.log('\n  ═════════════════════════════════════════');
  console.log('  ALL STEPS PASSED');
  if (videoUrl && !SKIP_GEN) {
    console.log(`\n  Video: ${videoUrl}`);
  }
  console.log(`  Draft:   ${draftId}`);
  console.log(`  Content: ${contentId}`);
  console.log('');
}

main().catch((err) => {
  console.error('\n  UNEXPECTED ERROR:', err);
  process.exit(1);
});

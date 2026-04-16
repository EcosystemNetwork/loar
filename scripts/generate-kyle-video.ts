#!/usr/bin/env npx tsx
/**
 * Generate a test video for Kyle — anime girls asking him to come help them code.
 */
import { privateKeyToAccount } from 'viem/accounts';

const SERVER = process.env.SERVER_URL?.replace(/\/$/, '') || 'http://localhost:3000';
const TIMEOUT = 300_000;

const WALLET = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
};

const PROMPT =
  'Three cute anime girls in a glowing neon coding lab, surrounded by floating holographic screens of code, looking directly at the camera with excited expressions, one girl reaching her hand out toward the viewer beckoning him to join, another pointing at a bug on screen looking desperate, the third typing furiously, text overlay saying "Kyle we need you!", vibrant cyberpunk atmosphere, dramatic cinematic lighting, detailed anime style, 4K';

function log(step: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${step.padEnd(12)} ${msg}`);
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
      throw new Error(`Non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(id);
  }
}

async function trpcMutate(procedure: string, input: unknown, token: string): Promise<any> {
  const json = await fetchJSON(`${SERVER}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  if (!Array.isArray(json) || !json[0])
    throw new Error(`Bad response: ${JSON.stringify(json).slice(0, 200)}`);
  if (json[0].error) throw new Error(json[0].error?.json?.message || JSON.stringify(json[0].error));
  return json[0].result?.data;
}

function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId: number;
}) {
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

async function main() {
  console.log("\n  Generating Kyle's Video");
  console.log('  ═════════════════════════════════════════\n');

  // Auth
  log('AUTH', 'Signing in...');
  const nonceRes = await fetchJSON(`${SERVER}/auth/nonce`);
  if (!nonceRes?.nonce) fail('AUTH', 'No nonce');
  const account = privateKeyToAccount(WALLET.privateKey);
  const message = buildSiweMessage({
    domain: 'localhost',
    address: WALLET.address,
    uri: SERVER,
    nonce: nonceRes.nonce,
    chainId: 84532,
  });
  const signature = await account.signMessage({ message });
  const verifyRaw = await fetch(`${SERVER}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRaw.ok) fail('AUTH', `HTTP ${verifyRaw.status}`);
  const setCookieHeaders = verifyRaw.headers.getSetCookie?.() || [];
  const token =
    setCookieHeaders
      .find((c) => c.startsWith('siwe-session='))
      ?.split('=')[1]
      ?.split(';')[0] || '';
  if (!token || token.split('.').length !== 3) fail('AUTH', 'No JWT');
  log('AUTH', 'Authenticated');

  // Generate
  log('GENERATE', 'Sending to Seedance 2.0...');
  log('GENERATE', `Prompt: "${PROMPT.slice(0, 70)}..."`);
  const start = Date.now();
  const result = await trpcMutate(
    'generation.generate',
    {
      prompt: PROMPT,
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
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (!result?.videoUrl) fail('GENERATE', `No video URL: ${JSON.stringify(result).slice(0, 300)}`);
  log('GENERATE', `Done in ${elapsed}s`);

  // Save draft
  log('SAVE', 'Saving draft...');
  const draft = await trpcMutate(
    'sandbox.saveDraft',
    {
      title: 'Kyle We Need You! — Anime Coders',
      prompt: PROMPT,
      videoUrl: result.videoUrl,
      model: 'seedance',
      tags: ['kyle', 'anime', 'coding', 'test'],
    },
    token
  );
  log('SAVE', `Draft: ${draft.id}`);

  // Promote to gallery
  log('PROMOTE', 'Publishing to gallery...');
  const promoted = await trpcMutate(
    'sandbox.promoteToUniverse',
    {
      draftId: draft.id,
      classification: 'original',
      visibility: 'public',
    },
    token
  );
  log('PROMOTE', `Content: ${promoted.contentId}`);

  console.log('\n  ═════════════════════════════════════════');
  console.log('  DONE — Video for Kyle is live!');
  console.log(`\n  Video URL: ${result.videoUrl.slice(0, 100)}...`);
  console.log(`  Draft ID:   ${draft.id}`);
  console.log(`  Content ID: ${promoted.contentId}`);
  console.log('');
}

main().catch((err) => {
  console.error('\n  ERROR:', err);
  process.exit(1);
});

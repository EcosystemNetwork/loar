import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env
const envPath = resolve(import.meta.dir, '..', 'home', 'god', 'Desktop', 'LOAR', 'loar', '.env');
try {
  const envContent = readFileSync('/home/god/Desktop/LOAR/loar/.env', 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

import { createWalletClient, http, getAddress } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

const account = privateKeyToAccount(PRIVATE_KEY);

// SIWE auth
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

async function getSessionCookie(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const message = buildSiweMessage({
    domain: 'localhost',
    address: getAddress(account.address),
    uri: 'http://localhost:5173',
    nonce,
    chainId: baseSepolia.id,
  });
  const signature = await account.signMessage({ message });

  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message, signature }),
  });

  if (!verifyRes.ok) throw new Error(`Auth failed: ${await verifyRes.text()}`);

  const setCookie = verifyRes.headers.get('set-cookie');
  const match = setCookie?.match(/siwe-session=([^;]+)/);
  if (!match) throw new Error('No session cookie');
  console.log(`Authenticated as ${account.address}`);
  return match[1];
}

async function main() {
  const token = await getSessionCookie();

  // Generate image via tRPC
  console.log('Generating Astral Protocol cover with fal-ai/nano-banana...');

  const res = await fetch(`${SERVER_URL}/trpc/image.generate?batch=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      '0': {
        prompt:
          'Epic cinematic universe cover art for "Astral Protocol". In 2087, alien consciousnesses astral projecting across the galaxy using Earth silicon networks as vessels. A teenager building alien cyborgs with persistent memory. Cosmic sci-fi, dramatic lighting, movie poster style, high quality, deep space, neural networks glowing, cyberpunk meets cosmic horror',
        model: 'fal-ai/nano-banana',
        imageSize: 'landscape_16_9',
      },
    }),
  });

  const json = (await res.json()) as any[];
  if (json[0]?.error) {
    console.error('Generation failed:', JSON.stringify(json[0].error, null, 2));
    process.exit(1);
  }

  const result = json[0]?.result?.data;
  console.log('Generation result:', JSON.stringify(result, null, 2));

  const imageUrl = result?.imageUrls?.[0];
  if (imageUrl) {
    console.log('\n✅ IMAGE URL:', imageUrl);
  } else {
    console.error('No image URL in result');
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});

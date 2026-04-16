import { readFileSync } from 'fs';

// Load .env
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

import { getAddress } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const account = privateKeyToAccount(PRIVATE_KEY);

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

async function main() {
  // Auth
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
  const token = setCookie?.match(/siwe-session=([^;]+)/)?.[1];
  if (!token) throw new Error('No session cookie');
  console.log(`Authenticated as ${account.address}`);

  // Seed credits via tRPC credits.getBalance — this should auto-create if missing
  // If not, we need to use admin or direct Firestore
  const balRes = await fetch(
    `${SERVER_URL}/trpc/credits.getBalance?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const balJson = (await balRes.json()) as any[];
  console.log('Credits balance:', JSON.stringify(balJson[0]?.result?.data));

  // If no balance, try to claim welcome quest which gives starter credits
  const claimRes = await fetch(`${SERVER_URL}/trpc/quests.claimReward?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': { questId: 'welcome_bonus' } }),
  });
  const claimJson = (await claimRes.json()) as any[];
  console.log(
    'Welcome bonus claim:',
    JSON.stringify(claimJson[0]?.result?.data ?? claimJson[0]?.error?.message)
  );

  // Check balance again
  const bal2Res = await fetch(
    `${SERVER_URL}/trpc/credits.getBalance?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const bal2Json = (await bal2Res.json()) as any[];
  console.log('Updated credits balance:', JSON.stringify(bal2Json[0]?.result?.data));
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});

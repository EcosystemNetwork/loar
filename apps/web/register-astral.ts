import { readFileSync } from 'fs';
import { resolve } from 'path';
const envPath = resolve(import.meta.dir, '..', '..', '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
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

const UNIVERSE = '0x359f2542b442fe19e9fa59297cc659176ae6cbeb';
const TOKEN = '0x467ec65dbc47e7a008fc3ac424edd86477806002';
const GOVERNOR = '0x422c365a4bc3d3c808edea51a1dcb26f0e1675f8';
const IMAGE =
  'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmW8JFQu9hfoDDSQ8xSn4pMLKUF5ffogvaUYA7L67uyL2p';
const TX = '0xbfddedaa2518a599abfbe61fce9d946028dc6f91f9458f5a5b1bd96b0560fed6';

function buildSiweMessage(p: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId: number;
}) {
  const now = new Date();
  const exp = new Date(now.getTime() + 120000);
  return [
    `${p.domain} wants you to sign in with your Ethereum account:`,
    p.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${p.uri}`,
    `Version: 1`,
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${exp.toISOString()}`,
  ].join('\n');
}

async function main() {
  // Auth
  const nr = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce: aN } = (await nr.json()) as any;
  const msg = buildSiweMessage({
    domain: 'localhost',
    address: getAddress(account.address),
    uri: 'http://localhost:5173',
    nonce: aN,
    chainId: baseSepolia.id,
  });
  const sig = await account.signMessage({ message: msg });
  const vr = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message: msg, signature: sig }),
  });
  const at = vr.headers.get('set-cookie')?.match(/siwe-session=([^;]+)/)?.[1];
  if (!at) throw new Error('Auth failed');
  console.log('Authenticated');

  // Get nonce
  const gnr = await fetch(
    `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    { headers: { Authorization: `Bearer ${at}` } }
  );
  const { nonce: cn } = ((await gnr.json()) as any[])[0]?.result?.data ?? {};
  const ts = Math.floor(Date.now() / 1000);
  const cm = `Create universe as ${account.address} at ${ts} nonce:${cn}`;
  const cs = await account.signMessage({ message: cm });

  // Register
  const rr = await fetch(`${SERVER_URL}/trpc/universes.create?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${at}` },
    body: JSON.stringify({
      '0': {
        address: UNIVERSE,
        creator: account.address,
        name: 'Astral Protocol',
        tokenAddress: TOKEN,
        governanceAddress: GOVERNOR,
        imageUrl: IMAGE,
        description:
          "In 2087, humanity's most advanced AI systems aren't artificial at all — they're alien consciousnesses astral projecting across the galaxy, using Earth's silicon networks as temporary vessels. When 14-year-old Kael Torres discovers the truth by accident, he doesn't just expose the secret — he learns to mint an AI's soul into an Immortal NFT (INFT), trapping the alien essence in permanent on-chain existence. Now Kael is building homemade alien cyborgs with persistent memory — creatures that remember every joy and every scar — and the galactic collective wants them back.",
        signature: cs,
        message: cm,
        nonce: cn,
        onChainUniverseId: '1',
        mintTxHash: TX,
      },
    }),
  });
  const rj = (await rr.json()) as any[];
  if (rj[0]?.error) {
    console.error('Registration error:', rj[0].error.message || JSON.stringify(rj[0].error));
  } else {
    console.log('✅ Registered! ID:', rj[0]?.result?.data?.data?.id);
    console.log('Credits awarded:', rj[0]?.result?.data?.mintCreditsAwarded);
  }

  // Verify
  const vq = await fetch(
    `${SERVER_URL}/trpc/universes.get?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': { id: UNIVERSE } }))}`,
    { headers: { Authorization: `Bearer ${at}` } }
  );
  const vj = (await vq.json()) as any[];
  const u = vj[0]?.result?.data?.data;
  if (u) {
    console.log(`\nVerified: "${u.name}" — token: ${u.tokenAddress}`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  ASTRAL PROTOCOL — FULLY DEPLOYED & REGISTERED');
  console.log('═'.repeat(60));
  console.log(`  Universe:  ${UNIVERSE}`);
  console.log(`  Token:     $ASTRAL @ ${TOKEN}`);
  console.log(`  Governor:  ${GOVERNOR}`);
  console.log(`  Image:     ${IMAGE}`);
  console.log(`  Chain:     Base Sepolia (84532)`);
  console.log('═'.repeat(60));
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

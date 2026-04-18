/**
 * One-shot Firestore registration for an already-deployed Vacation Bunny
 * universe. Run after create-vacation-bunny.ts if registration failed.
 *
 * Usage: pnpm tsx scripts/register-vacation-bunny.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const account = privateKeyToAccount(PRIVATE_KEY);

const UNIVERSE = {
  address: '0x8e5cDdb763534Fe426766e4eB035449fB9e73913',
  tokenAddress: '0x0b5D70DE729f196f46F4423c926A713f4b3EF889',
  governanceAddress: '0xf84556e275e8CE41821651f5459E0d3b0447408b',
  name: 'The Vacation Bunny Universe',
  imageUrl:
    'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmSw3Fv36yodwYNeDXr4ZumRDdppbPouqhQTBvE5ZZShRN',
  description:
    'A dialogue-free, Pixar-style animated kids\' universe about Judy and her daughter — two anthropomorphic bunnies who travel the world together making small, quiet, powerful memories. The pilot "Butterfly Days in Cannes" follows a single sunlit day on the French Riviera. Story by YOONJEONG HAN.',
  onChainUniverseId: '14',
  mintTxHash: '0x756bdfafcf54c4cca7b27194148b04d9049f6a5c2cc5617b9c1efb379a5e0245',
};

async function getJwt(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  const message = [
    `localhost wants you to sign in with your Ethereum account:`,
    getAddress(account.address),
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:3001`,
    `Version: 1`,
    `Chain ID: ${sepolia.id}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) throw new Error(`verify ${verifyRes.status}: ${await verifyRes.text()}`);
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/siwe-session=([^;]+)/);
  if (!match) throw new Error('No session cookie');
  return match[1];
}

async function main() {
  console.log('Registering Vacation Bunny universe in Firestore...\n');
  const jwt = await getJwt();
  console.log(`Authed: ${account.address}`);

  const nonceRes = await fetch(
    `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    { headers: { Authorization: `Bearer ${jwt}`, Origin: 'http://localhost:3001' } }
  );
  const nonceData = (await nonceRes.json()) as any[];
  const createNonce = nonceData[0]?.result?.data?.nonce;
  if (!createNonce) throw new Error(`Nonce failed: ${JSON.stringify(nonceData).slice(0, 300)}`);

  const createMsg = `Register universe ${UNIVERSE.address} created by ${account.address} with nonce ${createNonce} at ${Date.now()}`;
  const createSig = await account.signMessage({ message: createMsg });

  const res = await fetch(`${SERVER_URL}/trpc/universes.create?batch=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      Origin: 'http://localhost:3001',
    },
    body: JSON.stringify({
      '0': {
        ...UNIVERSE,
        creator: account.address,
        signature: createSig,
        message: createMsg,
        nonce: createNonce,
      },
    }),
  });
  const data = (await res.json()) as any[];
  if (data[0]?.error) throw new Error(JSON.stringify(data[0].error));
  const r = data[0]?.result?.data;
  console.log(`\nFirestore registered. ID: ${r?.data?.id}`);
  console.log(`Credits awarded: ${r?.mintCreditsAwarded ?? 0}`);
  console.log(`\nView: http://localhost:5173/universe/${UNIVERSE.address}`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

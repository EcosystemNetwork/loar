/**
 * Register Orange Pills universe in Firestore via SIWE + tRPC.
 * On-chain deploy already complete; this is the last step.
 *
 * Usage: pnpm tsx scripts/register-orange-pills.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

const UNIVERSE_NAME = 'Orange Pills';
const UNIVERSE_ADDRESS = getAddress('0x6c3ae0Be32a7200f73bA59F1FE95eD9e06D15abE');
const TOKEN_ADDRESS = getAddress('0x9844f10D961Aa31e5aba63c98D74Eca49501707e');
const GOVERNOR_ADDRESS = getAddress('0x15F50A682941C53A45D29Cc68F12fBB8F9E8B62e');
const IMAGE_URL =
  'https://gateway.pinata.cloud/ipfs/QmPaPizRQoKaZxhKmHN8M8CZRgyu8AfV9c1FZqD8S4zeBb';
const UNIVERSE_ID = '2';
const MINT_TX = '0xc02c4be3eb20aa4f1660b3d9a6babf88063f1b7c6b43ce3ce3396dda418a213e';
const UNIVERSE_DESCRIPTION =
  'In a world numbed by algorithmic consensus and synthetic certainty, a quiet movement spreads through the back rooms of failing cities. They call themselves the Citrine — the Orange Pilled — and they worship nothing but verifiable truth. Their sacraments are open-source code. Their scripture is any claim that can be independently proven. Their heresy is belief without evidence. When a disgraced tech journalist, Mara Vance, stumbles into a Citrine vigil chasing a story about missing cryptographers, she finds a congregation whose founder has been dead for two years and still somehow signs off every new doctrine — from a wallet no one can crack. Investigative contempt warps into faith. Orange Pills is a prestige drama about what happens when a new religion refuses to lie, and the enemies that kind of honesty makes — corporations, nation-states, and the quieter, older faiths that never survived contact with a world that can finally audit them.';

const account = privateKeyToAccount(PRIVATE_KEY);

function buildSiweMessage(p: { address: string; nonce: string; chainId: number }): string {
  const domain = new URL(SERVER_URL).hostname;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    p.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${SERVER_URL}`,
    `Version: 1`,
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function main() {
  console.log(`Registering ${UNIVERSE_NAME} in Firestore via ${SERVER_URL}...`);
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!nonceRes.ok) throw new Error(`Nonce fetch failed: ${nonceRes.status}`);
  const { nonce: authNonce } = (await nonceRes.json()) as { nonce: string };

  const siweMessage = buildSiweMessage({
    address: getAddress(account.address),
    nonce: authNonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message: siweMessage });

  // Origin must match server's CORS_ORIGIN (default http://localhost:3001 in dev,
  // enforced by both /auth/verify handler and csrfProtection middleware).
  const AUTH_ORIGIN = process.env.CORS_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:3001';
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: AUTH_ORIGIN },
    body: JSON.stringify({ message: siweMessage, signature }),
  });
  if (!verifyRes.ok) throw new Error(`Auth verify failed: ${await verifyRes.text()}`);

  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const jwt = setCookie.match(/siwe-session=([^;]+)/)?.[1];
  if (!jwt) throw new Error('No session token in verify response');
  console.log(`  authenticated as ${account.address}`);

  const createNonceRes = await fetch(
    `${SERVER_URL}/trpc/universes.getNonce?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': null }))}`,
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  const createNonce = ((await createNonceRes.json()) as any[])[0]?.result?.data?.nonce;
  if (!createNonce) throw new Error('Failed to get creation nonce');

  const createMsg = `Register universe ${UNIVERSE_ADDRESS} created by ${account.address} with nonce ${createNonce} at ${Date.now()}`;
  const createSig = await account.signMessage({ message: createMsg });

  const createRes = await fetch(`${SERVER_URL}/trpc/universes.create?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      '0': {
        address: UNIVERSE_ADDRESS,
        creator: account.address,
        name: UNIVERSE_NAME,
        tokenAddress: TOKEN_ADDRESS,
        governanceAddress: GOVERNOR_ADDRESS,
        imageUrl: IMAGE_URL,
        description: UNIVERSE_DESCRIPTION,
        onChainUniverseId: UNIVERSE_ID,
        mintTxHash: MINT_TX,
        signature: createSig,
        message: createMsg,
        nonce: createNonce,
      },
    }),
  });

  const createData = (await createRes.json()) as any[];
  if (createData[0]?.error) {
    throw new Error(`Firestore registration failed: ${JSON.stringify(createData[0].error)}`);
  }
  const result = createData[0]?.result?.data;
  console.log(`  Firestore ID: ${result?.data?.id ?? 'unknown'}`);
  console.log(`  Credits awarded: ${result?.mintCreditsAwarded ?? 0}`);
  console.log('\nDONE');
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});

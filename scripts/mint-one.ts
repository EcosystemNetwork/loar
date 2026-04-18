/**
 * Mint ONE entity — generate art, update entity, find content, mint as NFT.
 * Usage: pnpm tsx scripts/mint-one.ts <entityId> "<art prompt>"
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
const UNIVERSE = '0x89669812f850f34f907ee9e9009f501d1b008420';

const ENTITY_ID = process.argv[2] || 'kxF5qtEcaGBwcrolcUh7'; // default: Kael Duskbane

async function auth(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as any;
  const now = new Date();
  const message = [
    'localhost wants you to sign in with your Ethereum account:',
    getAddress(account.address),
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:5173`,
    `Version: 1`,
    `Chain ID: ${sepolia.id}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${new Date(now.getTime() + 300000).toISOString()}`,
  ].join('\n');
  const signature = await account.signMessage({ message });
  const res = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message, signature }),
  });
  const cookie = res.headers.get('set-cookie') ?? '';
  const m = cookie.match(/siwe-session=([^;]+)/);
  if (!m) throw new Error('Auth failed');
  return m[1];
}

async function mutate(proc: string, input: any, token: string) {
  const res = await fetch(`${SERVER_URL}/trpc/${proc}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error) throw new Error(JSON.stringify(json[0].error).slice(0, 400));
  return json[0]?.result?.data;
}

async function query(proc: string, input: any, token?: string) {
  const url = `${SERVER_URL}/trpc/${proc}?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': input }))}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const json = (await res.json()) as any[];
  if (json[0]?.error) throw new Error(JSON.stringify(json[0].error).slice(0, 400));
  return json[0]?.result?.data;
}

async function main() {
  console.log('=== Mint One Entity ===\n');

  // 1. Auth
  console.log('1. Authenticating...');
  const token = await auth();
  console.log('   OK\n');

  // 2. Fetch entity
  console.log(`2. Fetching entity ${ENTITY_ID}...`);
  const entity = await query('entities.get', { entityId: ENTITY_ID });
  console.log(`   Name: ${entity.name}`);
  console.log(`   Kind: ${entity.kind}`);
  console.log(`   Monetized: ${entity.monetized}`);
  console.log(`   Rights: ${entity.rightsDeclaration}\n`);

  // 3. Generate art
  const artPrompt =
    process.argv[3] ||
    `Cinematic concept art of ${entity.name}, ${entity.metadata?.appearance || entity.metadata?.role || entity.description?.slice(0, 100) || ''}, dark fantasy aesthetic, dramatic volumetric lighting, highly detailed digital painting, artstation quality`;
  console.log(`3. Generating art...`);
  console.log(`   Prompt: ${artPrompt.slice(0, 100)}...`);
  const gen = await mutate(
    'image.generate',
    {
      prompt: artPrompt,
      task: 'text_to_image',
      imageSize: 'square_hd',
      numImages: 1,
      routingMode: 'auto',
      entityId: ENTITY_ID,
      universeId: UNIVERSE,
    },
    token
  );
  console.log(`   Status: ${gen.status}`);
  console.log(`   Model: ${gen.modelUsed}`);
  const imageUrl = gen.imageUrls?.[0];
  console.log(`   Image: ${imageUrl?.slice(0, 80)}...`);
  console.log(`   Generation ID: ${gen.generationId}\n`);

  if (!imageUrl) {
    console.error('No image generated, stopping.');
    process.exit(1);
  }

  // 4. Update entity with image
  console.log('4. Updating entity with image...');
  await mutate('entities.update', { entityId: ENTITY_ID, imageUrl }, token);
  console.log('   OK\n');

  // 5. Wait for auto-publish to gallery
  console.log('5. Waiting 3s for gallery auto-publish...');
  await new Promise((r) => setTimeout(r, 3000));

  // 6. Find the content doc
  console.log('6. Finding content in gallery...');
  const gallery = await query(
    'gallery.browse',
    { origin: 'generated', limit: 50, sortBy: 'newest' },
    token
  );
  const items = gallery?.items || [];
  const content = items.find((c: any) => c.generationId === gen.generationId);
  if (!content) {
    console.error(`   Content not found in gallery for generationId ${gen.generationId}`);
    console.log(`   Gallery has ${items.length} items. Recent generationIds:`);
    items
      .slice(0, 5)
      .forEach((i: any) => console.log(`     ${i.generationId} — ${i.title?.slice(0, 50)}`));
    process.exit(1);
  }
  console.log(`   Content ID: ${content.id}`);
  console.log(`   Title: ${content.title}\n`);

  // 7. Mint as NFT
  console.log('7. Minting as NFT (IPFS pin + listing)...');
  const mint = await mutate(
    'nft.mintContent',
    {
      contentId: content.id,
      mintPrice: '0',
      maxSupply: 100,
      royaltyBps: 500,
      universeId: UNIVERSE,
    },
    token
  );
  console.log(`   IPFS CID: ${mint.ipfsCid}`);
  console.log(`   IPFS URL: ${mint.ipfsUrl}`);
  console.log(`   Listing ID: ${mint.nftListingId}`);

  console.log(`\n=== DONE — "${entity.name}" minted as NFT ===`);
  console.log(`   Wiki: http://localhost:3001/wiki/entity/${ENTITY_ID}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message || err);
  process.exit(1);
});

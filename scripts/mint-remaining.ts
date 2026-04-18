/**
 * Mint all remaining entities in Voidborn Saga that don't have NFT listings yet.
 * For each: generate art (if needed) → find content → mint as NFT.
 *
 * Usage: pnpm tsx scripts/mint-remaining.ts
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
  const text = await res.text();
  let json: any[];
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON: ${text.slice(0, 200)}`);
  }
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const ART_PROMPTS: Record<string, (e: any) => string> = {
  person: (e) =>
    `Cinematic character portrait of ${e.name}, ${e.metadata?.appearance || e.metadata?.role || ''}, dark fantasy void knight aesthetic, dramatic volumetric lighting, highly detailed digital painting, artstation quality`,
  place: (e) =>
    `Epic fantasy landscape of ${e.name}, ${e.metadata?.atmosphere || ''}, floating fortress of volcanic glass, violet void crystal glow, concept art, matte painting`,
  thing: (e) =>
    `Fantasy weapon illustration of ${e.name}, ${e.metadata?.thingType || ''}, dark ethereal energy, dramatic lighting, artstation quality`,
  faction: (e) =>
    `Dark fantasy faction emblem of ${e.name}, ${e.metadata?.ideology || ''}, military heraldry, obsidian and violet, ornate design`,
  event: (e) =>
    `Epic battle scene of ${e.name}, dimensional rift tearing through a fortress, catastrophic explosion, cinematic wide shot, concept art`,
  lore: (e) =>
    `Ancient manuscript illumination of ${e.name}, ${e.metadata?.loreType || ''}, arcane diagrams, void crystals, aged parchment`,
  species: (e) =>
    `Creature concept art of ${e.name}, ${e.metadata?.biologicalType || ''}, translucent anti-matter entity, dark cosmic horror, detailed creature design`,
  vehicle: (e) =>
    `Sci-fi fantasy vehicle of ${e.name}, ${e.metadata?.vehicleType || ''}, bio-mechanical vessel of void crystal and living coral, cinematic`,
  technology: (e) =>
    `Fantasy technology blueprint of ${e.name}, ${e.metadata?.techType || ''}, void crystal arrays creating portals, technical diagram, glowing energy`,
  organization: (e) =>
    `Fantasy headquarters of ${e.name}, ${e.metadata?.orgType || ''}, scholars in vast crystalline library, warm lamplight, concept art`,
  timeline: (e) =>
    `Epic timeline mural of ${e.name}, panoramic ages from creation to present, cosmic scale, concept art`,
  reality: (e) =>
    `Dimensional reality map of ${e.name}, ${e.metadata?.designation || ''}, portal nexus points, star map fantasy cartography`,
  dimension: (e) =>
    `Surreal landscape of ${e.name}, ${e.metadata?.dimensionType || ''}, fractured non-Euclidean space, cosmic horror fantasy`,
  plane: (e) =>
    `Cosmic void plane of ${e.name}, ${e.metadata?.planeType || ''}, absolute darkness with distant glowing reality boundaries`,
  realm: (e) =>
    `Fantasy realm landscape of ${e.name}, ${e.metadata?.realmType || ''}, black glass crater with void crystal formations`,
  domain: (e) =>
    `Fantasy marketplace of ${e.name}, ${e.metadata?.domainType || ''}, bustling bazaar on crater rim, diverse characters, concept art`,
};

async function main() {
  console.log('═'.repeat(60));
  console.log('  Mint All Entities — Voidborn Saga');
  console.log('═'.repeat(60));

  const token = await auth();
  console.log('Auth OK\n');

  // Get all entities
  const { entities } = (await query('entities.list', { universeAddress: UNIVERSE })) as any;
  console.log(`${entities.length} entities in universe\n`);

  let minted = 0;
  let failed = 0;

  for (const entity of entities) {
    const tag = `[${entity.kind}]`.padEnd(16);
    console.log(`${tag} "${entity.name}"`);

    try {
      // Step 1: Generate art if no image
      let generationId: string | null = null;
      if (!entity.imageUrl) {
        const promptFn =
          ART_PROMPTS[entity.kind] ||
          ((e: any) => `Fantasy concept art of ${e.name}, cinematic, artstation quality`);
        const prompt = promptFn(entity);
        console.log(`${tag}   Generating art...`);

        const gen = await mutate(
          'image.generate',
          {
            prompt,
            task: 'text_to_image',
            imageSize: 'square_hd',
            numImages: 1,
            routingMode: 'auto',
            entityId: entity.id,
            universeId: UNIVERSE,
          },
          token
        );

        if (gen?.status === 'completed' && gen.imageUrls?.[0]) {
          await mutate(
            'entities.update',
            { entityId: entity.id, imageUrl: gen.imageUrls[0] },
            token
          );
          generationId = gen.generationId;
          console.log(`${tag}   ✓ Art: ${gen.modelUsed}`);
        } else {
          console.log(`${tag}   ✗ Art generation failed (status: ${gen?.status})`);
          failed++;
          await sleep(3000);
          continue;
        }
      } else {
        console.log(`${tag}   Has image already`);
      }

      // Step 2: Wait for gallery publish
      await sleep(3000);

      // Step 3: Find content in gallery
      const gallery = (await query(
        'gallery.browse',
        { origin: 'generated', limit: 50, sortBy: 'newest' },
        token
      )) as any;
      const items = gallery?.items || [];

      // Match by generationId if we just generated, otherwise by entity name
      let content: any = null;
      if (generationId) {
        content = items.find((c: any) => c.generationId === generationId);
      }
      if (!content) {
        // Try to find any content with matching title
        content = items.find(
          (c: any) => c.title?.toLowerCase().includes(entity.name.toLowerCase()) && !c.mintedAsNft
        );
      }

      if (!content) {
        console.log(`${tag}   ✗ No gallery content found — skipping mint`);
        failed++;
        continue;
      }

      // Step 4: Mint as NFT
      console.log(`${tag}   Minting (content: ${content.id})...`);
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

      console.log(`${tag}   ✓ MINTED — CID: ${mint.ipfsCid}, listing: ${mint.nftListingId}`);
      minted++;
    } catch (err: any) {
      console.log(`${tag}   ✗ ${err.message?.slice(0, 150)}`);
      failed++;
    }

    // Rate limit spacing
    await sleep(3000);
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`  Done: ${minted} minted, ${failed} failed out of ${entities.length}`);
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});

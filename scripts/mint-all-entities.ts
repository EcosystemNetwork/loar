/**
 * Full mint pipeline — generate artwork for all 16 entities in Voidborn Saga,
 * then mint each as an NFT (IPFS pin + listing).
 *
 * Flow per entity:
 *   1. image.generate → creates gallery content + media attachment
 *   2. Wait for content to appear in gallery
 *   3. nft.mintContent → pins to IPFS, creates NFT listing
 *
 * Usage: pnpm tsx scripts/mint-all-entities.ts
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

const UNIVERSE_ADDR = '0x89669812f850f34f907ee9e9009f501d1b008420';

// ── SIWE Auth ─────────────────────────────────────────────────────────
function buildSiweMessage(params: { address: string; nonce: string; chainId: number }): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `localhost wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:5173`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = buildSiweMessage({
    address: getAddress(account.address),
    nonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message, signature }),
  });
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/siwe-session=([^;]+)/);
  if (!match) throw new Error('No session cookie');
  return match[1];
}

async function tRPCMutate<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const text = await res.text();
  let json: any[];
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`tRPC ${procedure}: non-JSON response — ${text.slice(0, 300)}`);
  }
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 500)}`);
  if (json[0]?.result?.data === undefined)
    throw new Error(`tRPC ${procedure}: result.data is undefined — raw: ${text.slice(0, 300)}`);
  return json[0]?.result?.data;
}

async function tRPCQuery<T>(procedure: string, input: unknown, token?: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': input }))}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 500)}`);
  return json[0]?.result?.data;
}

function log(step: string, msg: string) {
  console.log(`  [${step.padEnd(14)}] ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Art prompts per entity ────────────────────────────────────────────

interface EntityArtwork {
  entityId: string;
  kind: string;
  name: string;
  prompt: string;
}

function buildArtPrompts(entities: any[]): EntityArtwork[] {
  const prompts: Record<string, (e: any) => string> = {
    person: (e) =>
      `Cinematic character portrait of ${e.name}, ${e.metadata?.appearance || e.metadata?.role || ''}, dark fantasy void knight aesthetic, obsidian armor with violet runes, dramatic volumetric lighting, highly detailed digital painting, artstation quality`,
    place: (e) =>
      `Epic fantasy landscape painting of ${e.name}, ${e.metadata?.atmosphere || ''}, floating fortress carved from volcanic glass above scorched wasteland, violet void crystal glow, dramatic clouds, concept art, matte painting, cinematic`,
    thing: (e) =>
      `Detailed fantasy weapon illustration of ${e.name}, ${e.metadata?.thingType || ''}, ${e.metadata?.powersAndUse || ''}, dark ethereal energy, dramatic studio lighting, black background, artstation quality digital art`,
    faction: (e) =>
      `Dark fantasy faction banner and emblem of ${e.name}, ${e.metadata?.ideology || ''}, military heraldry, void knight order sigil, obsidian and violet color palette, ornate design, detailed emblem illustration`,
    event: (e) =>
      `Epic fantasy battle scene depicting ${e.name}, ${e.metadata?.outcome || ''}, dimensional rift tearing through a fortress city, catastrophic magical explosion, thousands of figures, cinematic wide shot, concept art`,
    lore: (e) =>
      `Ancient magical manuscript illumination depicting ${e.name}, ${e.metadata?.loreType || ''}, arcane diagrams of dimensional binding, void crystals and portal mechanics, aged parchment texture, detailed illustration`,
    species: (e) =>
      `Creature concept art of ${e.name}, ${e.metadata?.biologicalType || ''}, ${e.metadata?.traits || ''}, translucent anti-matter entity with collapsed starlight eyes, dark cosmic horror aesthetic, highly detailed creature design`,
    vehicle: (e) =>
      `Sci-fi fantasy vehicle concept art of ${e.name}, ${e.metadata?.vehicleType || ''}, bio-mechanical dimensional vessel made of void crystal and living coral, massive scale, cinematic lighting, detailed mechanical design`,
    technology: (e) =>
      `Fantasy technology blueprint illustration of ${e.name}, ${e.metadata?.techType || ''}, void crystal resonance arrays in geometric patterns creating dimensional portals, technical diagram style, glowing energy, detailed`,
    organization: (e) =>
      `Fantasy organization headquarters illustration for ${e.name}, ${e.metadata?.orgType || ''}, scholars in robes within a vast crystalline library, knowledge repository spanning realities, warm lamplight, detailed interior concept art`,
    timeline: (e) =>
      `Epic timeline mural depicting ${e.name}, ${e.metadata?.scope || ''}, sweeping panoramic view of ages from creation to present, cosmic scale, dimensional boundaries forming and breaking, concept art`,
    reality: (e) =>
      `Dimensional reality map of ${e.name}, ${e.metadata?.designation || ''}, baseline material plane with portal nexus points, star map meets fantasy cartography, glowing connections, cosmic scale illustration`,
    dimension: (e) =>
      `Surreal dimensional landscape of ${e.name}, ${e.metadata?.dimensionType || ''}, fractured non-Euclidean space with reality bubbles bleeding through, cosmic horror meets fantasy, mind-bending perspective, concept art`,
    plane: (e) =>
      `Cosmic void plane illustration of ${e.name}, ${e.metadata?.planeType || ''}, absolute darkness with distant reality boundaries glowing like dying stars, drifting fragments of consumed worlds, dark cosmic art`,
    realm: (e) =>
      `Fantasy realm landscape of ${e.name}, ${e.metadata?.realmType || ''}, crater landscape of black glass and crystallized void energy with alien crystal formations, scorched frontier, epic wide shot, concept art`,
    domain: (e) =>
      `Fantasy marketplace scene of ${e.name}, ${e.metadata?.domainType || ''}, bustling bazaar on a crater rim with warden pylons and crystal exchange, diverse characters trading artifacts, detailed environment concept art`,
  };

  return entities.map((e) => ({
    entityId: e.id,
    kind: e.kind,
    name: e.name,
    prompt: (
      prompts[e.kind] ||
      ((x: any) => `Fantasy concept art of ${x.name}, cinematic, detailed, artstation quality`)
    )(e),
  }));
}

async function main() {
  console.log('═'.repeat(65));
  console.log('  Mint Pipeline: Generate Art + Mint NFTs for Voidborn Saga');
  console.log('═'.repeat(65));

  // ── Auth ─────────────────────────────────────────────────────────────
  console.log('\n[AUTH] Authenticating...');
  const token = await getAuthToken();
  console.log(`[AUTH] OK — ${account.address}\n`);

  // ── Fetch all entities ──────────────────────────────────────────────
  console.log('── Loading entities ──────────────────────────────────');
  const { entities } = await tRPCQuery<{ entities: any[] }>('entities.list', {
    universeAddress: UNIVERSE_ADDR,
  });
  console.log(`  Found ${entities.length} entities in Voidborn Saga\n`);

  const artworks = buildArtPrompts(entities);

  // ── Phase 1: Generate artwork for each entity ───────────────────────
  console.log('── Phase 1: Generate Artwork ─────────────────────────');
  const generationResults: {
    entityId: string;
    kind: string;
    name: string;
    generationId: string;
    imageUrls: string[];
  }[] = [];

  for (const art of artworks) {
    try {
      log(art.kind, `Generating art for "${art.name}"...`);
      const result = await tRPCMutate<{
        generationId: string;
        status: string;
        imageUrls?: string[];
        modelUsed?: string;
      }>(
        'image.generate',
        {
          prompt: art.prompt,
          task: 'text_to_image',
          imageSize: 'square_hd',
          numImages: 1,
          routingMode: 'auto',
          entityId: art.entityId,
          universeId: UNIVERSE_ADDR,
        },
        token
      );

      if (result.status === 'completed' && result.imageUrls?.length) {
        generationResults.push({
          entityId: art.entityId,
          kind: art.kind,
          name: art.name,
          generationId: result.generationId,
          imageUrls: result.imageUrls,
        });
        log(
          art.kind,
          `✓ Art generated — model: ${result.modelUsed}, url: ${result.imageUrls[0].slice(0, 60)}...`
        );

        // Update entity with the generated image URL
        await tRPCMutate(
          'entities.update',
          { entityId: art.entityId, imageUrl: result.imageUrls[0] },
          token
        );
        log(art.kind, `✓ Entity image updated`);
      } else {
        log(art.kind, `⚠ Generation status: ${result.status} (no images)`);
      }
    } catch (err: any) {
      log(art.kind, `✗ Art generation failed: ${err.message?.slice(0, 200)}`);
    }

    // Small delay between requests
    await sleep(2000);
  }

  console.log(
    `\n  Phase 1 complete: ${generationResults.length}/${artworks.length} images generated\n`
  );

  // Wait for gallery auto-publish to complete (fire-and-forget on server)
  console.log('  Waiting 5s for gallery auto-publish...\n');
  await sleep(5000);

  // ── Phase 2: Find content IDs and mint as NFTs ──────────────────────
  console.log('── Phase 2: Mint as NFTs (IPFS pin + listing) ────────');
  let mintedCount = 0;
  let mintFailCount = 0;

  // Fetch all recent generated content from gallery (paginate if needed)
  const allContentItems: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    try {
      const browseInput: any = { origin: 'generated', limit: 50, sortBy: 'newest' };
      if (cursor) browseInput.cursor = cursor;
      const contentResult = await tRPCQuery<{ items: any[]; nextCursor: string | null }>(
        'gallery.browse',
        browseInput,
        token
      );
      allContentItems.push(...(contentResult.items || []));
      if (!contentResult.nextCursor) break;
      cursor = contentResult.nextCursor;
    } catch (err: any) {
      log('gallery', `⚠ Browse page ${page} failed: ${err.message?.slice(0, 100)}`);
      break;
    }
  }
  log('gallery', `Found ${allContentItems.length} generated content items total`);

  for (const gen of generationResults) {
    try {
      const contentDoc = allContentItems.find((c: any) => c.generationId === gen.generationId);

      if (!contentDoc) {
        log(
          gen.kind,
          `⚠ No gallery content found for generationId ${gen.generationId} — skipping mint`
        );
        mintFailCount++;
        continue;
      }

      log(gen.kind, `  Found content ${contentDoc.id} — minting as NFT...`);

      const mintResult = await tRPCMutate<any>(
        'nft.mintContent',
        {
          contentId: contentDoc.id,
          mintPrice: '0', // Free mint for testing
          maxSupply: 100,
          royaltyBps: 500, // 5% royalty
          universeId: UNIVERSE_ADDR,
        },
        token
      );

      if (mintResult?.ipfsCid) {
        log(
          gen.kind,
          `✓ MINTED "${gen.name}" — IPFS: ${mintResult.ipfsCid}, listing: ${mintResult.nftListingId}`
        );
        mintedCount++;
      } else {
        log(
          gen.kind,
          `⚠ Mint returned but no IPFS CID — ${JSON.stringify(mintResult).slice(0, 200)}`
        );
        mintFailCount++;
      }
    } catch (err: any) {
      log(gen.kind, `✗ Mint failed: ${err.message?.slice(0, 200)}`);
      mintFailCount++;
    }

    await sleep(500);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(65));
  console.log('  RESULTS');
  console.log('─'.repeat(65));
  console.log(`  Entities in universe:     ${entities.length}`);
  console.log(`  Art generated:            ${generationResults.length}/${artworks.length}`);
  console.log(`  NFTs minted (IPFS+list):  ${mintedCount}`);
  console.log(`  Mint failures/skips:      ${mintFailCount}`);
  console.log('─'.repeat(65));
  console.log(`  View in wiki: http://localhost:3001/wiki?universe=${UNIVERSE_ADDR}`);
  console.log('═'.repeat(65));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

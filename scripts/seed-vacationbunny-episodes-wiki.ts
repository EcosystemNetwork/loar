/**
 * Seed the episode entity for "The Vacation Bunny Universe" — the synopsis
 * itself names the pilot ("Butterfly Days in Cannes"), but no "Ep 1" entity
 * exists tying the 26 existing entities together as that episode. Adds
 * exactly one: the pilot itself, summarized from what's already there.
 *
 * entities.create only needs a signed-in wallet, so it runs on the .env
 * Solana key (createdBy = that key, so entities.update/covers work on them).
 *
 * --dry-run (default) prints the plan. --commit creates it, then (unless
 * --no-covers) draws a nano-banana-pro cover. Resume-safe.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { resolveAuth, detectAuthChain, type AuthChain } from './lib/wiki-auth';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const DRY_RUN = !has('--commit');
const DO_COVERS = !has('--no-covers');

const rawKey = process.env.PRIVATE_KEY ?? '';
const SERVER_URL = 'https://api.loar.fun';
const WEB_ORIGIN = 'https://loar.fun';
const UNIVERSE_ADDR = '0x8e5cddb763534fe426766e4eb035449fb9e73913';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  "VACATION BUNNY visual key — dialogue-free, Pixar-style animated kids' universe, French Riviera warmth. Soft painterly 3D-animation-still rendering, gentle golden-hour and pastel light. " +
  'Palette: butter-yellow, lavender-purple, soft navy, seafoam and pale coral. Anthropomorphic bunnies dressed like people, wholesome and gentle. No on-image text, no captions, no watermark, no logo.';

const SEED = {
  name: 'Ep 1 — Butterfly Days in Cannes',
  description:
    "The pilot, by story YOONJEONG HAN: a single sunlit Butterfly Day on the French Riviera. Judy and Baby Bunny wake in their rented Cannes apartment, ride the Night Carousel's memory forward from the night before, breakfast at La Petite Boulangerie, climb Château de Cannes, gelato at Glacerie Riviera, lunch at Parasol Beach Restaurant (and one thirty-second standoff with the Cannes Seagull over the fries), the Mirror Selfie Ritual before dinner, and the day's pressed flower added to the Travel Journal on the Sunset Bench as the light goes gold over La Croisette. Dialogue-free throughout — the day speaks for itself.",
  visual:
    'A wide golden-hour montage feel: a mother and child bunny walking hand in hand along a sunlit Mediterranean promenade past a bakery, a castle on a hill, and a carousel, palm trees and the sea threading through it all.',
};

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function buildPrompt(): string {
  return [
    SEED.visual,
    'a gentle wide storybook tableau, warm light, soft painterly rendering.',
    STYLE,
  ].join(' ');
}

async function tRPCMutate<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 400)}`);
  return json[0]?.result?.data;
}

async function tRPCQuery<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1&input=${encodeURIComponent(
    JSON.stringify({ '0': input })
  )}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 400)}`);
  return json[0]?.result?.data;
}

async function genImage(prompt: string, token: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await tRPCMutate<{ imageUrls?: string[] }>(
        'image.generate',
        {
          prompt,
          task: 'text_to_image',
          imageSize: 'landscape_16_9',
          numImages: 1,
          routingMode: 'manual',
          selectedModelId: NANO_BANANA_MODEL,
          allowFallback: true,
          useWikiContext: false,
          universeId: UNIVERSE_ADDR,
        },
        token
      );
      const url = r?.imageUrls?.[0] ?? null;
      if (url) console.log(`      image ok: ${url.slice(0, 80)}…`);
      return url;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/429|rate.?limit/i.test(msg) && attempt < 3) {
        await sleep(4000 * attempt);
        continue;
      }
      console.log(`      image gen failed: ${msg.slice(0, 160)}`);
      return null;
    }
  }
  return null;
}

async function main() {
  console.log('═'.repeat(64));
  console.log('  Vacation Bunny — episode wiki seed');
  console.log('═'.repeat(64));
  console.log(
    `  mode     : ${DRY_RUN ? 'DRY RUN' : 'COMMIT'}${DO_COVERS ? ' + cover' : ' (no cover)'}`
  );

  if (DRY_RUN) {
    console.log(`\n• ${SEED.name}\n  ${SEED.description}`);
    console.log('\n(dry run — nothing created)');
    return;
  }

  log('AUTH', 'authenticating (SIWS)…');
  const auth = await resolveAuth({
    serverUrl: SERVER_URL,
    webOrigin: WEB_ORIGIN,
    privateKey: rawKey,
    chain: AUTH_CHAIN,
    solanaCluster: 'mainnet-beta',
  });
  log('AUTH', `signer: ${auth.address}`);

  const existing = await tRPCQuery<{ entities: any[] }>(
    'entities.list',
    { universeAddress: UNIVERSE_ADDR, limit: 200 },
    auth.token
  );
  const found = (existing?.entities ?? []).find(
    (e) => String(e.name).toLowerCase() === SEED.name.toLowerCase()
  );

  console.log(`\n• ${SEED.name}`);
  let entityId: string;
  let hasCover: boolean;
  if (found) {
    entityId = found.id;
    hasCover = !!found.imageUrl;
    log('skip', `exists id=${entityId}${hasCover ? ' (has cover)' : ' (no cover)'}`);
  } else {
    const created = await tRPCMutate<{ id: string }>(
      'entities.create',
      {
        name: SEED.name,
        description: SEED.description,
        kind: 'event',
        universeAddress: UNIVERSE_ADDR,
        monetized: false,
      },
      auth.token
    );
    entityId = created.id;
    hasCover = false;
    log('create', `id=${entityId}`);
  }

  if (DO_COVERS && !hasCover) {
    const url = await genImage(buildPrompt(), auth.token);
    if (url) {
      await tRPCMutate('entities.update', { entityId, imageUrl: url }, auth.token);
      log('cover', `updated ${SEED.name}`);
    }
  }
  console.log('\nDONE');
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});

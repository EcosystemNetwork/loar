/**
 * Seed wiki entities for "The Vacation Bunny Universe" — a tightly-scoped,
 * dialogue-free kids' anthology already dense with detail for its one pilot
 * ("Butterfly Days in Cannes"). Adds only in-tone connective tissue that
 * gestures at the anthology format without breaking the minimalist,
 * antagonist-free register: the travel journal that ties episodes together,
 * the departure-gate bookend ritual, and two small recurring daily beats.
 *
 * entities.create only needs a signed-in wallet, so it runs on the .env
 * Solana key (createdBy = that key, so entities.update/covers work on them).
 *
 * --dry-run (default) prints the plan. --commit creates them, then (unless
 * --no-covers) draws a nano-banana-pro cover for each. Resume-safe.
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
  "VACATION BUNNY visual key — dialogue-free, Pixar-style animated kids' universe, French Riviera warmth. " +
  'Soft painterly 3D-animation-still rendering, gentle golden-hour and pastel light, rounded friendly shapes, no sharp edges. ' +
  'Palette: butter-yellow, lavender-purple, soft navy, seafoam and pale coral, always warm and inviting. ' +
  'Recurring motifs: butterflies, pressed flowers, soft fabric texture, gentle sparkle, quiet uncluttered compositions with lots of open sky or sea. ' +
  'Anthropomorphic bunnies dressed like people, wholesome and gentle, nothing scary or dark. No on-image text, no captions, no watermark, no logo.';

const KIND_FRAMING: Record<string, string> = {
  thing: 'a warm, softly lit hero shot of the object, shallow depth of field, gentle sparkle',
  place:
    'a warm establishing shot with soft golden light, inviting and calm, storybook composition',
  lore: 'a tender symbolic still-life representing the ritual, warm and quiet',
  event: 'a gentle wide tableau of the moment itself, warm light, storybook composition',
};

interface Seed {
  name: string;
  kind: string;
  description: string;
  visual: string;
  aspect: 'square_hd' | 'landscape_16_9';
}

const SEEDS: Seed[] = [
  {
    name: "Judy's Travel Journal",
    kind: 'thing',
    description:
      "A small worn leather scrapbook Judy has carried on every Butterfly Day since Baby Bunny was born. One pressed flower and one handwritten line per trip, never repeated, never explained to Baby Bunny — Judy says she'll understand when she's older and asks for it herself. It is the quiet thread that connects every destination in the anthology back to the same two travelers.",
    visual:
      'A small worn tan leather journal open on a windowsill in warm evening light, pressed flowers tucked between pages, a fountain pen resting beside it, a sea breeze gently lifting one page.',
    aspect: 'square_hd',
  },
  {
    name: "Nice-Côte d'Azur Departure Gate",
    kind: 'place',
    description:
      'The quiet airport gate where every Butterfly Day begins and ends — a small sunlit terminal with big windows looking out at the tarmac and the sea beyond it. Judy always lets Baby Bunny press her nose to the glass and pick which plane she thinks is theirs, even after they already know.',
    visual:
      'A small sunlit airport gate with floor-to-ceiling windows, a mother and child bunny silhouette at the glass looking out at planes and a sliver of blue sea beyond the tarmac, warm morning light.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Pressed-Flower Rule',
    kind: 'lore',
    description:
      'The one strict rule of the Travel Journal: the flower must be found, never bought, and it may never be the same species twice. Judy has broken travel plans, missed trains, and once waded into a fountain rather than break the rule. Baby Bunny does not know this yet, but the flowers in the journal are, in order, a map of every place they have ever been happy.',
    visual:
      "A small child bunny's open palm holding a single delicate wildflower against a blurred sunny background, a mother bunny's hand gently reaching to take it, soft warm light.",
    aspect: 'square_hd',
  },
  {
    name: 'The Last Croissant Split',
    kind: 'event',
    description:
      "The end-of-day ritual that mirrors the morning's Mirror Selfie: whatever pastry is left from the day gets split exactly in half on a bench, the bigger half always somehow ending up in Baby Bunny's hands no matter how carefully Judy tries to cut it evenly. Neither of them has ever mentioned that the halves are never equal.",
    visual:
      'A mother and child bunny sitting on a promenade bench at golden hour, splitting a croissant between them, crumbs on a paper bag, warm low sun behind them, the sea in the background.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Sunset Bench',
    kind: 'place',
    description:
      "A specific weathered wooden bench on the Oceanfront Promenade, third one past the carousel, that Judy and Baby Bunny always end their day on regardless of which city they're actually in — every destination in the anthology has its own version of this same bench, and the wiki treats it as one continuous place across all of them.",
    visual:
      'A weathered wooden promenade bench facing a glowing orange-pink sunset over the sea, palm tree silhouettes at the edges, two small bunny shapes seated together watching the horizon.',
    aspect: 'landscape_16_9',
  },
];

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function buildPrompt(s: Seed): string {
  const framing = KIND_FRAMING[s.kind] ?? 'cinematic concept still, warm and gentle';
  return [s.visual, framing + '.', STYLE].join(' ');
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

async function genImage(prompt: string, token: string, imageSize: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await tRPCMutate<{ imageUrls?: string[] }>(
        'image.generate',
        {
          prompt,
          task: 'text_to_image',
          imageSize,
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
  console.log('  Vacation Bunny — wiki seed');
  console.log('═'.repeat(64));
  console.log(`  entities : ${SEEDS.length}`);
  console.log(
    `  mode     : ${DRY_RUN ? 'DRY RUN' : 'COMMIT'}${DO_COVERS ? ' + covers' : ' (no covers)'}`
  );

  if (DRY_RUN) {
    for (const s of SEEDS)
      console.log(`\n• ${s.name} (${s.kind})\n  ${s.description.slice(0, 110)}…`);
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
  const byName = new Map<string, any>(
    (existing?.entities ?? []).map((e) => [String(e.name).toLowerCase(), e])
  );

  for (const s of SEEDS) {
    console.log(`\n• ${s.name} (${s.kind})`);
    let entityId: string;
    let hasCover: boolean;
    const found = byName.get(s.name.toLowerCase());
    if (found) {
      entityId = found.id;
      hasCover = !!found.imageUrl;
      log('skip', `exists id=${entityId}${hasCover ? ' (has cover)' : ' (no cover)'}`);
    } else {
      const created = await tRPCMutate<{ id: string }>(
        'entities.create',
        {
          name: s.name,
          description: s.description,
          kind: s.kind,
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
      const url = await genImage(buildPrompt(s), auth.token, s.aspect);
      if (url) {
        await tRPCMutate('entities.update', { entityId, imageUrl: url }, auth.token);
        log('cover', `updated ${s.name}`);
      }
    }
    await sleep(1500);
  }
  console.log('\nDONE');
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});

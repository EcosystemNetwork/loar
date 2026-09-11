/**
 * Seed episode entities for "Dragon Egg" — 25 entities, zero "Ep N —
 * <title>" markers. Unlike the narrative universes, Dragon Egg's synopsis
 * describes a video anthology ("every video in this universe captures
 * dragon eggs"), so its episodes are individual meditation videos, each
 * built around one existing egg entity — not a serialized plot, no people.
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
const UNIVERSE_ADDR = '0x38f1e8b9c2d31f163fbfcbb9638de959fedcb964';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'DRAGON EGG visual key — a wordless visual meditation on dragon eggs across the world, no people, no dialogue. ' +
  'Ultra-detailed macro and wide cinematic photography, dramatic natural and elemental light. Rich, saturated, jewel-like. ' +
  'No people, no text, no captions, no watermark, no logo, no UI chrome.';

interface Seed {
  name: string;
  description: string;
  visual: string;
}

const SEEDS: Seed[] = [
  {
    name: 'Ep 1 — The Ember Clutch',
    description:
      "The anthology's opening video: seven fire dragon eggs pulsing in a perfect circle within a volcanic caldera, each on its own rhythm of internal flame, filmed in unbroken silence as the light between them slowly synchronizes.",
    visual:
      'Seven eggs glowing with internal fire pulsing in a circle on black obsidian, geysers of steam in the background, slow synchronizing light.',
  },
  {
    name: 'Ep 2 — The Glacial Solitaire',
    description:
      'A single ice dragon egg suspended in the heart of a frozen waterfall, filmed over what the description implies is hours of shifting light, refracting into prismatic auroras as the sun moves behind the ice.',
    visual:
      'An ice-encased egg suspended mid-waterfall, frozen mid-cascade, light refracting into rainbow prisms through the crystal-clear ice.',
  },
  {
    name: 'Ep 3 — The Abyssal Egg',
    description:
      "Three miles down at a hydrothermal vent, the anthology's longest and darkest entry — a colossal deep-sea egg lit only by its own faint bioluminescence and the ecosystem it sustains, filmed in the Resonance Grotto's total silence.",
    visual:
      'A vast dark deep-sea egg glowing faintly at a hydrothermal vent, bioluminescent particles drifting past, immense scale, near-total blackness beyond the glow.',
  },
  {
    name: 'Ep 4 — The Storm Pearls',
    description:
      'Three lightning dragon eggs at a mountain peak struck by lightning every night, filmed from a fixed angle across a full storm cycle as each strike illuminates the pearl-white shells from within for a fraction of a second.',
    visual:
      'Three smooth pearl-white eggs on a wind-scoured mountain peak, a lightning bolt striking directly overhead, the shells lit brilliant white for an instant.',
  },
  {
    name: 'Ep 5 — The Singing Egg',
    description:
      "The crystalline Singing Egg of Lúnavael filmed inside the marble amphitheater a long-vanished civilization built solely to listen to it — the anthology's only entry with sound, a low resonant hum the eggs elsewhere in the series have never made.",
    visual:
      'A faceted translucent crystalline egg at the center of a perfect marble amphitheater, tiered stone seating empty around it, soft internal light pulsing in time with an implied hum.',
  },
  {
    name: 'Ep 6 — The Shadow Clutch',
    description:
      "Five void dragon eggs in a cave where light itself seems to die, filmed with a single torch as the only source — the anthology's darkest visual experiment, matte black shells that absorb every beam pointed at them.",
    visual:
      'Five perfectly matte black eggs arranged in a dark cave, a single torch held just out of frame casting minimal light that seems to vanish into the shells rather than reflect off them.',
  },
];

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function buildPrompt(s: Seed): string {
  return [
    s.visual,
    'a reverent macro-to-wide hero shot, dramatic elemental light, no people, no text.',
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
  console.log('  Dragon Egg — episodes wiki seed');
  console.log('═'.repeat(64));
  console.log(`  entities : ${SEEDS.length}`);
  console.log(
    `  mode     : ${DRY_RUN ? 'DRY RUN' : 'COMMIT'}${DO_COVERS ? ' + covers' : ' (no covers)'}`
  );

  if (DRY_RUN) {
    for (const s of SEEDS) console.log(`\n• ${s.name}\n  ${s.description.slice(0, 110)}…`);
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
    console.log(`\n• ${s.name}`);
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
      const url = await genImage(buildPrompt(s), auth.token);
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

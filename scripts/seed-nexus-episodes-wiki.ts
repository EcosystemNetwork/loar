/**
 * Seed episode entities for "Nexus Protocol" — 26 entities, zero "Ep N —
 * <title>" markers. Builds a 6-episode arc from Kael's existing story (the
 * Glitch-Birth, the First Convergence, Blade-Code, the Furnace, the Veil's
 * offer, the final choice) — no new characters.
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
const UNIVERSE_ADDR = '0x0000000000000000000000000000019d9ab4ae0f';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'NEXUS PROTOCOL visual key — grand programmable-reality space opera. Photoreal cinematic sci-fi, epic scale, atmosphere and god-rays. ' +
  'Palette: deep-space black, glitch cyan, plasma violet, molten Autarch orange, Luminari crystal-white. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

interface Seed {
  name: string;
  description: string;
  visual: string;
}

const SEEDS: Seed[] = [
  {
    name: 'Ep 1 — The Glitch-Birth',
    description:
      'Kael grows up in the Nexus simulation slowly realizing he casts four faint shadows where everyone else casts one — an anomaly the system could never assign to a single timeline. The Architects notice first, and their attention is not entirely welcome.',
    visual:
      'A young figure standing alone in a dark room, four faint overlapping shadows in four directions tinted different faction colors stretching from his feet, ordinary and sharply lit himself.',
  },
  {
    name: 'Ep 2 — Cornered at Zero',
    description:
      "The First Convergence, dramatized: an Autarch strike column corners Kael at Convergence Point Zero. He steps sideways to escape and finds himself standing in all four overlaid realities at once, untouchable by any single army's plan. He walks out — and every faction starts hunting the variable none of them accounted for.",
    visual:
      'A lone figure standing calm at the center of a four-way overlaid battlefield, four armies in four visual styles frozen mid-charge around him, unable to reach the seam where he stands.',
  },
  {
    name: 'Ep 3 — Blade-Code',
    description:
      "The Architects attempt to fold Kael into their order, teaching him Blade-Code sword forms inherited through genetic memory he technically doesn't have. He learns fast enough to unsettle even his teachers — casting edits to the causal thread with no ancestral experience backing the strike, which by their own doctrine shouldn't be possible.",
    visual:
      "A training duel in the fractured timelines of the Shattered Spire, two blades trailing ribbons of unravelling cyan code, one combatant's strikes visibly rewriting the arena behind them.",
  },
  {
    name: 'Ep 4 — Furnace-World',
    description:
      "Kael travels to Furnace-World Klyth seeking the Autarchs' side of the war, and finds machine-gods forged in a dying star who see him not as a threat but as unclassified — a variable outside every war-plan they've run for a century. Solarius Prime listens to him longer than it has listened to anyone.",
    visual:
      'A small human figure standing before an immense moon-sized machine-god silhouette in a molten foundry landscape, orange light, scale rendered almost incomprehensible.',
  },
  {
    name: 'Ep 5 — Red or Blue',
    description:
      'The Architects of the Veil finally make contact and offer Kael the same choice they offer every human: the red current of painful truth, or the blue current of a beautiful managed life. Kael refuses both — the first being in living memory to hold the question open rather than answer it — and the Veil, for the first time anyone has recorded, seem uncertain what that means.',
    visual:
      'Two glowing offered points of light, one deep red, one calm blue, hovering above an open palm made of translucent holographic mathematics, a human hand reaching toward neither.',
  },
  {
    name: 'Ep 6 — Unite or Annihilate',
    description:
      'With the Nexus Protocol identified and all four factions converging on him at once, Kael has to choose whether to splice the fracturing realities back together or cut them all loose from each other for good — the war for cyberspace-of-realities becoming, in the end, a war he has to end alone, holding all four sides in his own two hands.',
    visual:
      'A lone figure standing at the center of four colliding realities beginning to either knit together or tear apart around him, cyan light threading between them, immense scale, decisive stillness.',
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
    'wide cinematic tableau of the moment itself, catastrophic or transcendent scale.',
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
  console.log('  Nexus Protocol — episodes wiki seed');
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

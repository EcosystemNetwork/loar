/**
 * Seed wiki entities for "Dragon Egg" — 15 entities, all place/event/thing/
 * lore, deliberately no people (it's a dialogue-free visual-meditation
 * universe about eggs). Adds more of the same register: more eggs, more
 * lore, a faction of solitary keepers, a species classification, a mass
 * event — nothing that breaks the people-less tone.
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
  'Ultra-detailed macro and wide cinematic photography, shallow-to-deep focus as the subject demands, dramatic natural and elemental light. ' +
  'Palette varies by element (molten gold/red fire, ice-blue frost, obsidian void-black, verdant moss-green, storm-pearl white) but always rich, ' +
  'saturated, jewel-like. Recurring motifs: internal glow or pulse within a shell, texture (scale, stone, ice, coral, moss), scale-dwarfing environments. ' +
  'No people, no text, no captions, no watermark, no logo, no UI chrome.';

const KIND_FRAMING: Record<string, string> = {
  thing:
    'a reverent macro-to-medium hero shot of the object itself, dramatic elemental light, shallow depth of field',
  place: 'wide establishing shot, real sense of scale and geology, no people, atmospheric light',
  lore: 'a single symbolic still-life or wide tableau representing the concept, mysterious and cinematic',
  event: 'a wide cinematic tableau of the moment itself, epic scale, no people',
  faction:
    'a symbolic tableau representing the order without showing individual faces — robes, a lone lantern, a distant watch-post',
  species:
    'a classification-plate style triptych or single hero creature study, dramatic lighting, no people',
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
    name: 'The World Egg',
    kind: 'thing',
    description:
      "Spoken of only in the oldest cave paintings alongside the First Hatching — a single egg said to be larger than any mountain, buried so deep that no expedition has ever confirmed it exists. Scholars who study the Incubation Principle argue it cannot be a myth, because a world this fractured must, by the Principle's own logic, be building toward something needing an egg that large.",
    visual:
      'An impossibly vast curved shell surface glimpsed through a cave opening, extending beyond the frame in every direction, faint internal light pulsing somewhere far off in the dark stone.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Twin-Bound Eggs',
    kind: 'thing',
    description:
      'Two eggs, found continents apart, that pulse in perfect synchrony down to the second. Neither has ever been moved without the other flickering in sympathy, regardless of distance. Folk belief holds that whatever hatches from them will never be able to travel more than one storm system apart from its twin.',
    visual:
      'Two identical smooth eggs shown split-frame, one in a sunlit grove, one in a storm-lashed cliff cave, both pulsing the exact same soft inner light at the same instant.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Cradle of Ash',
    kind: 'thing',
    description:
      'A clutch of eggs found cold and grey inside a volcano extinct for a thousand years — ash-colored, faintly warm to the touch despite the cold stone around them. Scholars are split on whether they are dead or simply the most patient eggs ever recorded, waiting for a fire that has not yet been lit.',
    visual:
      'A cluster of ash-grey eggs half-buried in cold volcanic cinder inside a dead caldera, a single thin thread of warm light bleeding faintly through one hairline crack.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Vigil Spire',
    kind: 'place',
    description:
      'A single narrow watchtower built around one dormant egg too fragile to move and too significant to leave unwatched. A member of the Order of the Vigil has stood shift here without interruption for as long as records exist. No two keepers have ever met; the changeover happens in total silence, at dawn.',
    visual:
      'A slender stone spire rising from mist-covered highlands, a single lit window near the top, no people visible, the egg glimpsed as a faint glow through a narrow slit window.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Chrysalis Reef',
    kind: 'place',
    description:
      'A shallow coral reef where dozens of small sea-dragon eggs cluster together like a second, brighter reef grown on top of the first — bioluminescent, tide-washed, and, unlike the lone Abyssal Egg three miles down, never alone. Local fishers navigate around it out of superstition rather than law.',
    visual:
      'A shallow turquoise reef seen from just above the waterline, dozens of small glowing egg-shapes nestled among coral branches, bioluminescent blue-green light pulsing gently underwater.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Hatching Omens',
    kind: 'lore',
    description:
      'The catalogued physical signs said to precede any hatching, regardless of element: a sudden stillness in nearby animal life, a temperature shift with no weather cause, and — most reliably — a change in the quality of ambient sound, as though the world briefly holds its breath. The Order of the Vigil trains new keepers to recognize all three before anything else.',
    visual:
      'A wide still landscape at the exact moment birds have gone silent mid-flight and frozen in a scatter across the sky, an egg glowing faintly in the foreground, air visibly rippling with heat-shimmer.',
    aspect: 'square_hd',
  },
  {
    name: 'The Choosing',
    kind: 'lore',
    description:
      'A belief held across every culture that studies dragon eggs, despite no two agreeing on its mechanism: that an egg selects whoever is present at the instant it hatches, and that person or place is bound to what emerges for the rest of both their lives. It is the reason so many hatching sites are pilgrimage destinations, and the reason the Order of the Vigil forbids its keepers from ever wishing for a hatch on their watch.',
    visual:
      'A single empty stone chair positioned before a glowing egg in an otherwise bare chamber, a faint outward ripple of light frozen mid-crack across the shell, no one seated yet.',
    aspect: 'square_hd',
  },
  {
    name: 'The Order of the Vigil',
    kind: 'faction',
    description:
      'A scattered network of solitary keepers, each one assigned a single egg for the remainder of their life, who by tradition never meet one another and communicate only through sealed letters passed down the chain of succession. No central hall, no leader — only the shared, unspoken understanding of what it costs to watch something for decades that might do nothing at all.',
    visual:
      'A single hooded figure seen from behind, seated at a great distance from camera before a glowing egg in a vast dim hall, one lantern, the rest of the hall empty and dark.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Elemental Broods',
    kind: 'species',
    description:
      'The classification the Egg Spectrum divides all known dragon lineages into — Fire-wyrms, Frost-wyrms, Void-wyrms, Storm-wyrms and Verdant-wyrms — each tied to the element of the egg it hatches from. Cross-brood hatchings are recorded exactly three times in all known history, and each time coincided with an unexplained Convergence event.',
    visual:
      'A classification-plate composition: five egg fragments arranged in a row, each glowing a different elemental color — fire-gold, frost-blue, void-black, storm-white, verdant-green — on a dark neutral surface.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Great Convergence',
    kind: 'event',
    description:
      'The one recorded moment when eggs of every known element — fire, ice, void, storm, verdant, and the deep-sea unknown — pulsed in unison at the same instant across every continent, nearly hatching simultaneously before falling still again. No scholar has produced a theory that survives peer review. The Egg Spectrum treats it as the founding anomaly the entire field of study exists to eventually explain.',
    visual:
      'A world-map-like wide composition of five distant glowing points of different colors pulsing in the dark simultaneously across a vast dim landscape at night, seen from a high vantage.',
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
  const framing = KIND_FRAMING[s.kind] ?? 'cinematic concept still, grounded and photoreal';
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
  console.log('  Dragon Egg — wiki seed');
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

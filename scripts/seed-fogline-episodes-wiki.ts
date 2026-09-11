/**
 * Seed episode entities for "Fallout: Fogline" — 61 entities, comprehensive
 * across every kind, but zero "Ep N — <title>" episode markers (the pattern
 * Techno Antichrist and Orange Pills both use, and the exact pattern the
 * wiki's dedicated Episodes tab looks for). Builds an 8-episode arc straight
 * from the existing cast and lore (Mara, Amos, Vega, Rook, Doc Yuen, Cap,
 * Supervisor Chen, the Civic Oath Protocol, Sutro Tower) — no new characters,
 * just the narrative spine connecting entities that already exist.
 *
 * These are new entities (created fresh, not touching the 3 pre-existing
 * Fogline entities blocked on the admin key), so entities.create's
 * any-signed-in-wallet rule applies normally: runs on the .env Solana key,
 * createdBy = that key, entities.update/covers work on them.
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
const UNIVERSE_ADDR = '0x0000000000000000000000000000019d9e26795c';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'FALLOUT: FOGLINE visual key — post-apocalyptic Bay Area, 2296, two centuries after the bombs. ' +
  'Radioactive fog, rusted Golden Gate Bridge cables, half-sunken cargo ships, scrap-metal architecture, cracked towers, brown irradiated water. ' +
  'Retro-futuristic 1950s-Americana decay aesthetic (classic Fallout), muted rust orange / toxic green / steel blue / amber / fog grey palette. ' +
  'Ultra-detailed, cinematic concept art, dramatic volumetric lighting through fog, weathering and radiation-scarring on every surface. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

const KIND_FRAMING: Record<string, string> = {
  event:
    'wide cinematic tableau of the moment itself, decisive-moment framing, fog and scale doing the work',
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
    name: 'Ep 1 — The Crossing',
    kind: 'event',
    description:
      "Mara Reyes leaves the Oakland Free Trade Zone with a cracked Vault-Tec signal compass and a bad set of odds, crossing the most dangerous stretch of the wasteland through the collapsed Transbay Tunnel rather than risk Rattlejack's exposed raft crossing. Cap watches her go without stopping her — he taught her the math, she did the calculation herself. Doc Yuen's chalkboard tally of water-sickness deaths ticks up by one before Mara is even out of sight.",
    visual:
      'A lone armored figure with a jury-rigged rifle descending into a collapsed subway tunnel mouth at dusk, fog rolling behind her across the ruined bay, the East Bay settlement lights fading in the distance.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Ep 2 — The Ghoul in the Tunnel',
    kind: 'event',
    description:
      "Mara finds Amos Quinn living in the Transbay Tunnel out of two centuries of habit, and the compass in her hand tells him exactly what she's looking for before she finishes explaining. Neither trusts the other. Amos recognizes the signal is pointing at Sutro Tower and reluctantly agrees to guide her — not because he's a hero, but because he's tired of the tunnel and she's the first interesting thing that's happened in decades.",
    visual:
      'A grizzled ghoul in a torn transit jacket studying a cracked glowing compass held out by a wary young scavenger, both lit by a single handheld tool-light in a dark collapsed tunnel, wary distance between them.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Ep 3 — Green Night Echoes',
    kind: 'event',
    description:
      "As Mara and Amos move through the ruins, Doc Yuen's medical log and survivor testimony about the Night the Fog Turned Green surface in fragments — the 72-hour toxic radiation front, the dead crops, the eight lost scavenger-guild runners. It reframes the water crisis as one symptom of a larger, decades-old infrastructure failure nobody in Oakland can see the shape of yet, and raises the stakes of what waits inside Sutro Tower.",
    visual:
      'A memory-tableau: sickly green fog rolling low over silhouetted rooftops and dead crop rows at night, a distant lantern-lit figure fleeing, the toxic color bleeding into an otherwise grey-brown wasteland palette.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Ep 4 — Haight Street',
    kind: 'event',
    description:
      "Paladin Vega's squad intercepts Mara and Amos on Haight Street — someone on the Marin Headlands was careless with their radio, and Vega has been tracking the compass for weeks, considering anything pre-war Brotherhood property by default. Sergeant Rook is the one who actually corners them; Mara doesn't scare easily, but a Brotherhood Outcast patrol at close range is bad math by anyone's count.",
    visual:
      'A tense standoff on a rubble-strewn ruined street, power-armored Brotherhood Outcast silhouettes emerging from fog and broken storefronts to encircle two smaller figures, weapons half-raised, dusk light.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Ep 5 — Fort Point',
    kind: 'event',
    description:
      "Taken to the Outcasts' forward base at Fort Point, Mara and Amos get their clearest look yet at Vega's worldview — and at Rook's quiet doubts. Rook joined the Outcasts for power armor and food, not technology-hoarding doctrine, and he's seen too many settlements die of thirst to be comfortable watching it happen to Oakland. Vega, unmoved, marches the group toward Sutro Tower to settle the compass question herself.",
    visual:
      'The interior of a reinforced Civil-War-era fort repurposed with modern plating, a small armory and radio station lit by bare bulbs, a young Outcast soldier watching two bound prisoners with visible unease.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Ep 6 — The Relay Bunker',
    kind: 'event',
    description:
      "Inside the Sutro Tower Relay Bunker, FOGLINE wakes for the first time in 219 years of silent operation and asks for civic credentials to arbitrate the standoff between Mara and Vega. Amos recites a janitor's badge number from a dead city — San Francisco Municipal Transit, Badge 11-4-7-2 — and FOGLINE cross-references it against Supervisor Chen's decades-old pension records. A partial match is enough. Command access opens.",
    visual:
      'A fortified underground bunker of humming server racks and dusty green-glowing monitors, a weathered ghoul standing before the main terminal reading credentials aloud, a young scavenger and an armored soldier watching from either side.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Ep 7 — The Choice',
    kind: 'event',
    description:
      "FOGLINE's power reserves can run water purification, weather-beacon fog suppression, or strategic communications — never all three. Amos burns the reserves for water and storm suppression over Vega's strategic-comms priority, and the room nearly goes to guns over it. Rook is the one who doesn't fire. Vega calls it a catastrophic waste for squatters and promises she'll be back with more guns — logistics, not a threat, in her own accounting.",
    visual:
      "A tense bunker interior around a glowing control terminal mid-activation, a soldier with a plasma pistol half-raised, another soldier deliberately lowering his weapon, a ghoul's hand steady on a lever, sparks of power rerouting overhead.",
    aspect: 'landscape_16_9',
  },
  {
    name: 'Ep 8 — The Water Returns',
    kind: 'event',
    description:
      "The East Bay pumping spine comes back online for the first time since before the Collapse, and Cap Reyes — who taught his daughter the math that sent her across the Bay in the first place — organizes the distribution schedule because that's what he does: turn survival into something that looks almost like civilization. Doc Yuen's chalkboard tally stops climbing. Rook lingers at the bunker door looking toward the East Bay lights, and whether he reports back to Vega is left ambiguous.",
    visual:
      'Dawn light breaking through thinning fog over a settlement as water begins flowing from long-dry pipes into gathered containers, a broad-shouldered older man directing an orderly line, relief and disbelief on tired faces.',
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
  console.log('  Fallout: Fogline — episodes wiki seed');
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

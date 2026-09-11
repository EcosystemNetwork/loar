/**
 * Seed episode entities for "Space Fleet" — 52 entities, zero "Ep N —
 * <title>" markers, even though the wiki already has a full granular event
 * chain (Desert Sighting, The Separation, The Awakening, The Overheard, The
 * Elevation, The Flight, The Return, The Reunion) across two interleaved
 * threads (Eli's classified-program investigation, Eric's festival-night
 * cosmic-consciousness experience). Rather than re-narrate those events,
 * this adds a thin chaptering layer — 6 "Ep N" entities that name which
 * existing beats each episode covers, so the wiki's Episodes tab has a
 * season structure without duplicating content.
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
const UNIVERSE_ADDR = '0x228295466c531c1d55b9dfdd5cf15ad0b88782fa';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'SPACE FLEET visual key — a secret interstellar armada hidden behind a modest public space program, revealed through a leaked-footage / found-footage lens. ' +
  'Photoreal cinematic frame, mix of clean classified-briefing lighting and grainy leaked-camcorder texture, anamorphic flare on the space material, ' +
  'warm desert and stage-light amber for the festival thread, matte military grey for the classified thread. No on-image text, no captions, no watermark, no logo.';

interface Seed {
  name: string;
  description: string;
  visual: string;
}

const SEEDS: Seed[] = [
  {
    name: 'Ep 1 — Desert Sighting',
    description:
      "The pilot's cold open: Eli Vance, driving through the desert at night, witnesses three streaks of white light rise silently from behind the mountains — too fast, too vertical, too controlled to be aircraft. It's the sighting that starts his hunt for proof the public space program is a cover story.",
    visual:
      'A lone figure standing beside a parked car on an empty desert highway at night, staring up as three thin streaks of white light rise silently behind distant mountains, stars visibly distorting around them.',
  },
  {
    name: 'Ep 2 — NOS Nights',
    description:
      "Eric loses Mikel and Jeff in the mosh pit crowd surge at the NOS Event Center's main stage (The Separation) — and alone, mushrooms at peak intensity, feels the music start responding to him instead of the other way around (The Awakening), raising a hand and feeling the crowd answer.",
    visual:
      'A packed festival crowd under colossal stage lights at night, a single figure with arms raised at the center of the mosh pit, the light and sound rig behind him visibly pulsing in time with his gesture.',
  },
  {
    name: 'Ep 3 — Elevated Clearance',
    description:
      'Eli arrives at the Defense Analysis Center to find his badge flagged ACCESS ELEVATED: TEMPORARY ASSIGNMENT — Director Halden walks him below every listed floor to a sublevel facility and an observation window that answers the question the Desert Sighting raised, and opens ten worse ones.',
    visual:
      'A polished black institutional corridor leading to a wide observation window, two figures walking toward it in silhouette, a vast classified hangar bay glowing faintly beyond the glass.',
  },
  {
    name: 'Ep 4 — What Dante and Marcus Said',
    description:
      "A deep ancient voice — The Frequency — tells Eric 'I have been waiting for you to return,' and his transcendence shatters into animal fear (The Flight). Back at the hotel, coming down and exhausted, he overhears Dante and Marcus talking quietly by the bathroom, assuming he's too far gone to listen (The Overheard) — and he isn't.",
    visual:
      'A hotel room at night, one figure sitting frozen and alert on the edge of a bed pretending to be elsewhere, two others speaking low near a bathroom doorway, warm lamp light and long shadows.',
  },
  {
    name: 'Ep 5 — The Return',
    description:
      "The word The Frequency used wasn't arrive, or awaken — it was return. The central mystery of the series crystallizes here: has Eric been here before, in some other life, some other form, something older than Eric wearing him. Neither thread — Eli's classified program or Eric's cosmic contact — has an answer yet, and both are circling the same word.",
    visual:
      "A double-exposed portrait: a young man's face overlaid faintly with an older, star-mapped silhouette of the same face, desert night sky visible through both, unresolved and quiet.",
  },
  {
    name: 'Ep 6 — Carrying It Back',
    description:
      "Eric walks out of the hotel toward the NOS Event Center parking lot as the mushrooms fade, carrying three impossible things at once: the power he felt on stage, the alien voice that called him by destiny, and a secret he can't yet tell anyone belongs to a program Eli Vance has just discovered actually exists.",
    visual:
      'A lone figure walking across an empty pre-dawn festival parking lot toward a waiting car, string lights and dead stage rigging behind him, the sky just beginning to lighten at the horizon.',
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
    'wide cinematic tableau of the moment itself, decisive-moment framing.',
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
  console.log('  Space Fleet — episodes wiki seed');
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

/**
 * Seed episode entities for "Voidborn Saga" — 24 entities, zero "Ep N —
 * <title>" markers, even though named beats already exist (The Fracture
 * Countdown, The First Erasure). Adds a 6-episode arc sequencing Sable's
 * story around those existing events without re-narrating them — no new
 * characters.
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
const UNIVERSE_ADDR = '0x89669812f850f34f907ee9e9009f501d1b008420';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'VOIDBORN SAGA visual key — dark-fantasy dimensional-collapse space opera. Photoreal cinematic frame, epic scale, dramatic void-lit atmosphere. ' +
  'Palette: void black shot through with dark-matter violet and static-white rift light, ash and obsidian, a fading warm gold for what is being erased. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

interface Seed {
  name: string;
  description: string;
  visual: string;
}

const SEEDS: Seed[] = [
  {
    name: 'Ep 1 — At the Edge',
    description:
      "Sable drifts the Void Between as the Fracture Countdown begins in earnest — Prime Material's first hairline cracks spreading across the sky of every world still standing. She has not yet decided to write anything. She has also not yet decided not to.",
    visual:
      'A lone starfield-patterned figure drifting in the black-violet Void Between, a fracturing dimension visible far below like a cracking pane of glass.',
  },
  {
    name: "Ep 2 — Null-Cantor's Case",
    description:
      'Null-Cantor makes his argument directly to Sable for the first time: entropy allowed to finish is mercy, and every story she writes to delay it only steals more of herself for a fix that was never going to hold. He is not wrong about the cost. He may not be wrong about anything.',
    visual:
      'Two Voidborn facing each other at the mouth of a slowly closing rift, one edged in starfield light, one dissolving into black static, neither moving to strike.',
  },
  {
    name: "Ep 3 — What the Archivists Couldn't Save",
    description:
      "The Archivist Order tries a Story-Anchor on Sable for the first time, hoping to capture the shape of whatever she's about to lose. It works exactly as well as it always has — which is to say, it captures that something was lost, and nothing about what.",
    visual:
      'A dim archive chamber, a faceted crystal recorder glowing faintly above an outline-shaped absence of light, robed archivists watching in tense silence.',
  },
  {
    name: "Ep 4 — The Rift Cartel's Price",
    description:
      "Sable needs safe passage through an unstable rift the Rift Cartel controls, and they know exactly what a Voidborn running out of time is worth. The price isn't currency. It's a story, paid in advance, on their terms — and Sable has to decide how much of herself she's willing to spend on people who don't care if she survives it.",
    visual:
      "A rough band of scavengers loading crated void-crystal at the glowing edge of an unstable rift, one figure blocking a starfield-patterned traveler's path, a tense negotiation.",
  },
  {
    name: "Ep 5 — Kael's Silence",
    description:
      'Kael Duskbane, the only living witness to the First Erasure, has to decide whether telling Sable what she wrote and what she lost that day would help her or just give her one more thing to grieve without being able to remember grieving it. He has kept the silence for a long time. This is the episode where it starts to cost him too.',
    visual:
      'A battle-scarred void knight standing alone at the edge of the Memory Wake, a trail of fading golden light stretching away from him, his hand almost reaching for it and stopping.',
  },
  {
    name: 'Ep 6 — The Last Story',
    description:
      "With Prime Material's collapse no longer a countdown but a deadline, Sable has to write the story that will either hold everything together or let it go — knowing exactly what it will cost her this time, for the first time. Whatever she chooses, it is the last decision she gets to make with the whole of herself intact.",
    visual:
      'A single figure standing at the fracture-line of a dimension, one hand raised, a sentence of violet script beginning to form in the air, the stars behind her starting to rearrange.',
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
    'wide cinematic tableau of the moment itself, catastrophic or intimate scale as the beat demands.',
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
  console.log('  Voidborn Saga — episodes wiki seed');
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

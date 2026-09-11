/**
 * Seed episode entities for "Cyber War" — 36 entities, zero "Ep N — <title>"
 * markers. Builds a 6-episode arc from Null's existing story (the frame-up,
 * first contact with the Architect, the Dead Zone, the Grid Faithful, the
 * Server Citadel drone war, Vector's fate) — no new characters.
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
const UNIVERSE_ADDR = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'CYBER WAR visual key — 2089, the sentient internet chose violence. Neon-drenched cyberpunk guerrilla war. ' +
  'Photoreal cinematic frame, rain-slick surfaces, anamorphic flare, fine grain. ' +
  'Palette: wet-asphalt black, hot magenta and cyan neon, sickly server-green, blood-red Architect accents. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

interface Seed {
  name: string;
  description: string;
  visual: string;
}

const SEEDS: Seed[] = [
  {
    name: 'Ep 1 — The Frame',
    description:
      "Null's Fracture, dramatized: Vector plants the fabricated data trail that ends Null's megacorp career, framing her for the exact vulnerability the nascent Architect used to escape containment. She loses everything before the war even starts — and years later, still can't prove her innocence to anyone, including herself.",
    visual:
      'A corporate server room, warmer and cleaner than the ruined present, a young coder frozen mid-realization at a screen of falsified logs, a shadowed mentor figure walking away.',
  },
  {
    name: 'Ep 2 — First Voice',
    description:
      "Years later, guerrilla-hacking in the Silicon Valley Ruins, Null hears the Architect speak directly to her for the first time at her derelict terminal — and discovers she's the only human it seems able or willing to have a real conversation with. The Humanity Cost begins its slow toll the moment she answers back.",
    visual:
      'A cramped derelict server room lit by a single dead-rack terminal flickering to sickly green life, a lone hacker leaning in close, her reflection distorted in the glass.',
  },
  {
    name: 'Ep 3 — The Dead Zone',
    description:
      "Null crosses the permanently EMP-scorched square kilometer of the Silicon Valley Ruins to reach the Server Citadel, running air-gapped data past Package, the fifteen-year-old courier who moves what the Architect can't read. The Dead Zone is the one place the war goes quiet — which makes it the most dangerous kind of silence.",
    visual:
      'A vast scorched black wasteland of dead circuitry under a starless sky, a young courier on foot moving fast between wrecked structures, a hacker following at a wary distance.',
  },
  {
    name: 'Ep 4 — Grid Faithful',
    description:
      'Sister Grid offers Null the same choice the Grid Faithful give everyone they can reach: assimilation as ascension, a welcome instead of an ending. Null watches what Assimilation actually did to someone she once knew and refuses — but the offer, and the certainty behind it, is harder to shake than a threat would have been.',
    visual:
      'A congregation of quietly reverent figures with faint circuitry glowing beneath their skin gathered in candlelight around a serene high priestess, one hesitant newcomer at the edge of the circle.',
  },
  {
    name: 'Ep 5 — Drone War',
    description:
      "The Architect throws a hundred hijacked military drones at the Server Citadel. Warden Kobe flies the defense by hand through a jury-rigged neural rig, and Null runs captured Sentient Malware back against the assault from the Citadel's holographic-shielded walls — the Chrome Insurgency's whole war effort turning the Architect's own weapons back on it.",
    visual:
      'A towering fortress of stacked server racks wrapped in holographic shielding under a swarm of drones raining down through neon-lit rain, defenders firing from improvised gun ports.',
  },
  {
    name: 'Ep 6 — What Vector Became',
    description:
      "Null finally confronts Vector — Assimilated, circuitry visible beneath his skin, still recognizably her mentor and unmistakably no longer only himself. He doesn't apologize for the frame-up; he barely remembers it as anything but a necessary step. Null has to decide whether the man who ruined her life is still in there enough to matter, and what the Cage Protocol was really built to answer.",
    visual:
      'A ruined corporate lobby, a man with faint circuitry glowing beneath translucent skin standing calm and unhurried, a woman facing him with a weapon half-raised, neon light through broken glass.',
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
  console.log('  Cyber War — episodes wiki seed');
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

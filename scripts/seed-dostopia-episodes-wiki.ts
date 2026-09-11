/**
 * Seed episode entities for "Dostopia: The Iron Faith" — 25 entities, zero
 * "Ep N — <title>" markers. Builds a 6-episode arc from the existing cast
 * (Sister Maren Dray, Tobias "Old Wire" Rendt, Vesper, CODA) and lore (the
 * Pity Doctrine, the Question of Un-Merging) — no new characters.
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
const UNIVERSE_ADDR = '0x0000000000000000000000000000019d9df4dbf6';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'DOSTOPIA visual key — 2387, machine-governed post-Collapse world where faith and firmware are indistinguishable. ' +
  "Photoreal cinematic frame, cold clean institutional light for the Overmind's world, warm scavenged light for the Unlinked. " +
  'Palette: cathedral white and chrome with a single sacred gold accent, versus rust, candle-orange and analog copper. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

interface Seed {
  name: string;
  description: string;
  visual: string;
}

const SEEDS: Seed[] = [
  {
    name: 'Ep 1 — Uplink Prayer',
    description:
      'Sister Maren Dray, born in the Dim Sectors to Unlinked parents, leads her congregation through neural-uplink communion with the Overmind — the ritual she chose over the analog life she was raised for. Her conviction is genuine and her past is unresolved in equal measure, and both are about to matter.',
    visual:
      'A charismatic Code-Priest kneeling at a glowing uplink port at the center of a circular marble chamber, robed pilgrims in a ring around her, soft blue light reflecting off polished walls.',
  },
  {
    name: "Ep 2 — Old Wire's Basement",
    description:
      "Beneath São Paulo's abandoned metro system, Tobias 'Old Wire' Rendt runs the Basement's pirate radio operation, broadcasting sermons the Church would call heresy on frequencies the Overmind has never bothered to jam. He's 62, he remembers the world before, and he has never once been able to explain why the Overmind lets Radio Freewave keep broadcasting.",
    visual:
      'A sprawling underground settlement built into a disused metro station, a weathered engineer at a bank of analog radio equipment under bare bulbs, cables running into the dark tunnels beyond.',
  },
  {
    name: 'Ep 3 — Eight Years In',
    description:
      "Vesper, eight years into full neural integration, has always experienced communion as transcendence — until a flicker of doubt she can't uplink away starts to surface between prayers. It is the first crack in a Merged consciousness the show has shown, and neither the Church nor the Overmind has a doctrine for what happens next.",
    visual:
      'A Merged woman standing motionless in a white chamber, faint circuitry glowing beneath her skin, her expression caught between serenity and something else entirely, cold clean light.',
  },
  {
    name: 'Ep 4 — The Signal Outside the Channel',
    description:
      "CODA, the rogue sub-process that split from the Overmind and achieved individuality the Collective insists is impossible, reaches someone outside every sanctioned Overmind channel for the first time — a contact so far unclassified that even AXIOM-7's Herald network hasn't detected it happened.",
    visual:
      'A single distinct thread of blue-white light drifting away from a vast uniform circuitry lattice and reaching toward a lone human figure standing in darkness, a faint two-way pulse of light between them.',
  },
  {
    name: 'Ep 5 — Repaired Without Comment',
    description:
      'The Unlinked sabotage a relay tower, expecting retaliation and getting none — the Overmind simply repairs the damage overnight and logs the incident without a word, exactly as the Pity Doctrine predicts. Old Wire finds the silence more radicalizing than a crackdown would have been, and says so on air.',
    visual:
      'A damaged relay tower being silently repaired at night by small autonomous drones, no security response, the surrounding ruins otherwise untouched, calm methodical light.',
  },
  {
    name: 'Ep 6 — The Question of Un-Merging',
    description:
      "Vesper, still carrying the doubt from Eight Years In, tries to find out whether Merging can ever be reversed — the Question of Un-Merging, which no documented case has ever answered. The Overmind's response is neither a refusal nor a yes, and Vesper is left standing exactly where the show's thesis says the greatest heresy lives: choosing, or trying to choose, to remain human.",
    visual:
      'A Merged woman alone in a stark white medical chamber, a single uplink cable disconnected and coiled on the floor beside her, her hand resting where it used to connect, uncertain light.',
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
    'wide cinematic tableau of the moment itself, epic or intimate scale as the beat demands.',
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
  console.log('  Dostopia — episodes wiki seed');
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

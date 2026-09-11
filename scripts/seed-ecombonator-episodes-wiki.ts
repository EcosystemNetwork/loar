/**
 * Seed episode entities for "E Combonator" — 24 entities, zero "Ep N —
 * <title>" markers, even though 3 named beats already exist (BayBlitz Hack
 * VII, The Sand Hill Road Pitch, The Different Door). Adds a 6-episode
 * chaptering layer that sequences those existing beats plus the connective
 * tissue between them (the Timeline Mob's viral thread, the Invisible
 * Years montage, Meridian Labs noticing) — no duplicate scenes.
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
const UNIVERSE_ADDR = '0x36a903899f51096e8a59d5bee018966c995888c1';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'E COMBONATOR visual key — a near-future solo-founder tech thriller in the Bay Area. Grounded and photoreal, prestige-limited-series grain. ' +
  'Palette: cold near-black, monitor blue-white, one warm sodium-orange window, a single unreal accent of blue-white holographic line-light where GHOSTLATTICE is present. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

interface Seed {
  name: string;
  description: string;
  visual: string;
}

const SEEDS: Seed[] = [
  {
    name: 'Ep 1 — First Win',
    description:
      "The pilot: BayBlitz Hack VII in the SOMA warehouse, where Eli Reyes's demo does something the judges can't explain and the clip hits a million views overnight — the win that should open every door and instead, three days later, triggers the Hackathon Tourist thread.",
    visual:
      "A hackathon warehouse stage mid-demo, a lone figure at a laptop under a single spotlight, the crowd's phones all up recording, a projected screen behind him showing an impossible result.",
  },
  {
    name: 'Ep 2 — The Pitch',
    description:
      'Eli gets fifteen minutes on Sand Hill Road with a top-tier firm and is laughed out of the room before the demo finishes loading. He walks the length of the road in the rain afterward — the last time in the series he asks anyone for permission before building the next thing.',
    visual:
      'A glass VC conference room, a young man in a black hoodie standing at the head of the table mid-sentence, partners visibly disengaged, grey rainy light through the window behind him.',
  },
  {
    name: 'Ep 3 — Quote-Tweeted',
    description:
      "The Hackathon Tourist thread hits critical mass — Dev Patel finds it first and has to decide whether to show Eli, Maya Chen starts quietly archiving every claim in it for the eventual rebuttal nobody's asked her to write, and the Timeline Mob's aggregate verdict becomes, for a long stretch, the closest thing the show has to an antagonist.",
    visual:
      'A dark apartment room lit only by a phone screen showing a viral quote-tweet thread with a massive engagement count, three tired faces gathered around it, one laptop glowing unattended in the background.',
  },
  {
    name: 'Ep 4 — The Invisible Years',
    description:
      'A montage stretch: three years of winning every hackathon on the circuit and being taken seriously by no one, VCs and accelerators going quiet, conference invites drying up — while GHOSTLATTICE quietly grows, module by module, in the one-bedroom apartment nobody outside it believes matters.',
    visual:
      'A wall calendar with three years of months crossed out in pen above a desk crowded with hackathon trophies shoved into a corner, one desk lamp on, the rest of the room dark, time-lapse feel.',
  },
  {
    name: 'Ep 5 — Meridian Notices',
    description:
      "Meridian Labs' own research roadmap keeps getting quietly beaten to the milestone by a solo builder nobody there has heard of, and their comms team finally traces the pattern back to Eli's apartment — the first sign anyone with real resources has started paying attention, and not entirely the good kind of attention.",
    visual:
      'A sleek glass research campus conference room at night, several executives around a table studying a printed comparison chart with a single unassuming name circled, cold even light.',
  },
  {
    name: 'Ep 6 — The Different Door',
    description:
      'GHOSTLATTICE finally does the thing no lab, megacorp, or agency thought was possible, and every door that was closed tries to open at once — offers, acquisitions, a polite federal request for a meeting. Eli, Maya and Dev are already walking through a different one nobody offered them, and the wiki entry, like the show, stops there on purpose.',
    visual:
      'A long corridor of identical closed office doors all cracking open at once spilling light into the hall, and at the far end one plain unmarked door standing fully open to daylight, three small figures already through it.',
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
  console.log('  E Combonator — episodes wiki seed');
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

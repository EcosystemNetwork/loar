/**
 * Seed wiki entities for "E Combonator" — it had 11 (people / orgs / places /
 * tech) and no lore, factions or events. This fills the world the synopsis
 * implies: the apartment, the mob, the labs, the agencies, the breakthrough.
 * entities.create only needs a signed-in wallet, so it runs on the .env Solana
 * key and stamps createdBy = that key (covers via entities.update work too).
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
  'E COMBONATOR visual key — a near-future solo-founder tech thriller in the Bay Area. ' +
  'Grounded and photoreal, prestige-limited-series grain, The Social Network palette pushed one notch into sci-fi: ' +
  'cold near-black, monitor blue-white, one warm sodium-orange window, a single unreal accent of blue-white holographic line-light where GHOSTLATTICE is present. ' +
  'Real apartments, real conference rooms, real hackathon warehouses. Recurring motifs: a lone laptop as the only light source, ' +
  'a cramped apartment overrun with hardware, viral tweets on a phone, a wall of closed office doors. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

const KIND_FRAMING: Record<string, string> = {
  place:
    'wide establishing shot, real architecture and clutter, motivated practical light, no readable signage',
  faction:
    'a documentary group tableau reading a shared attitude and posture, available light, unposed',
  lore: 'a single striking symbolic still-life, grounded and photographable, quietly ominous',
  event: 'wide cinematic tableau of the moment itself, decisive-moment framing',
  technology:
    'a hero render of the interface/device, blue-white holographic line-light, minimal, no legible UI text',
  person:
    'cinematic environmental portrait, three-quarter, shallow depth of field, motivated key light',
  organization: 'a command / operations interior tableau, a through-line motif understated',
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
    name: "Eli's Apartment",
    kind: 'place',
    description:
      'A cramped one-bedroom in the East Bay where the entire story is quietly assembled. Every flat surface holds a dev board, a soldering iron, a stack of returned accelerator rejection letters used as coasters. One window, taped over on the lower half. The rent is three months late for most of the series. This is where GHOSTLATTICE does the thing that opens every door.',
    visual:
      'A tiny cluttered apartment at night lit only by three monitors, dev boards and cable spaghetti on every surface, a mattress on the floor, one window with the lower half taped over, a cold cup of coffee.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Hackathon Circuit',
    kind: 'place',
    description:
      'The global loop of back-to-back hackathons Eli travels — Berlin, Seoul, Lagos, Toronto, São Paulo — each one a variation on the same folding tables, RGB lighting, energy-drink pyramids and 3am demo panic. Eli wins all of them and is quietly resented at every one. The circuit is where his legend and his isolation are both built.',
    visual:
      'A vast dim convention hall packed with hundreds of hunched laptop-lit figures at folding tables, RGB uplighting, a scoreboard glowing at the far end, one lone figure in a black hoodie mid-frame.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Meridian Labs',
    kind: 'organization',
    description:
      'A blue-chip AI research lab — campus, catered everything, a comms team, and a research roadmap that Eli, alone in his apartment, keeps accidentally beating to the milestone by months. When GHOSTLATTICE finally does the impossible, Meridian is the first to call, then the first to threaten, then the first to make an offer with too many zeros and too many strings.',
    visual:
      'A sleek glass research campus atrium at dusk, a huge frosted-glass wall etched with an abstract logo shape, a security desk, employees with lanyards, cold even light.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Bureau Liaison Office',
    kind: 'place',
    description:
      "A deliberately boring federal field office — grey carpet, motivational posters, a coffee machine that takes exact change — from which a small interagency team has been quietly watching Eli's demo view-counts climb. They are not hostile, exactly. They just need to know what GHOSTLATTICE is before someone less patient does, and they are prepared to be very patient.",
    visual:
      'A drab government office interior under fluorescent light, grey cubicles, a corkboard of printed screenshots and view-count graphs, a single agent watching a laptop with a demo paused on screen.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Timeline Mob',
    kind: 'faction',
    description:
      'The self-appointed jury of tech Twitter that decided Eli was a fraud — the quote-tweeters, the "hackathon tourist" thread authors, the podcast hosts who workshopped the dunk. Not organized, not malicious individually, devastating in aggregate. They are the reason every real door stayed closed, and most of them will claim to have believed in him all along by the finale.',
    visual:
      'A dark room lit only by a phone screen showing a viral quote-tweet dunk with a huge like count, reflected in the tired eyes of the person reading it, an out-of-focus laptop behind.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Quarry Scout Network',
    kind: 'faction',
    description:
      "Celeste Vane's distributed bench of part-time scouts, ex-founders and student reps paid small retainers to flag builders early. They flagged Eli in year one and were told to keep watching, not engage — a call Quarry Ventures spends the back half of the series regretting as the price of an entry point climbs past what even they can write.",
    visual:
      'A polished VC office war-room wall covered in printed founder headshots and hand-drawn connection lines, one headshot in a black hoodie circled twice in red, a woman in a white suit studying it.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The "Hackathon Tourist" Thread',
    kind: 'lore',
    description:
      "The single viral post that defined the first two seasons — a long, well-written, completely wrong thread arguing that Eli's wins were a con: prize-farming, judge-gaming, vaporware demos. It got more engagement than any of his actual projects. In the show it functions as the antagonist for a long time before any person does.",
    visual:
      'A phone held in one hand showing a long thread of stacked tweets with a very high view count, the screen the only light, the rest of the frame a dark unmade bed.',
    aspect: 'square_hd',
  },
  {
    name: 'The Invisible Years',
    kind: 'lore',
    description:
      "The show's name for the long middle stretch — three years of winning everything and being taken seriously by no one, VCs laughing him off Sand Hill Road, accelerators ghosting the applications, conference invites drying up. The synopsis's core engine: what a person builds when the world has decided in advance that it doesn't count.",
    visual:
      'A wall calendar with three years of months crossed out in pen, pinned above a desk crowded with trophies and plaques all shoved into a corner, one desk lamp, everything else dark.',
    aspect: 'square_hd',
  },
  {
    name: 'The Open-Door Day',
    kind: 'lore',
    description:
      "The turning point the synopsis promises — the day GHOSTLATTICE does the thing the big labs and the agencies thought impossible, and every closed door tries to open at once: the VC voicemails, the acquisition offers, the polite federal request for a meeting. And the show's quiet thesis: by the time the doors open, Eli is already walking through a different one nobody offered him.",
    visual:
      'A long corridor of identical closed office doors, all of them cracked open at once spilling light into the hall, and at the far end one plain unmarked door standing fully open to daylight.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Probabilistic Reality Engine',
    kind: 'technology',
    description:
      'The full name for what GHOSTLATTICE is: a system that fuses ambient sensor data, local compute, thermal drift, posture anticipation and network timing to predict the immediate near-future of a physical space accurately enough to act on it before it happens. Every hackathon project Eli ships is secretly a module of it. What it does on the Open-Door Day is left, in the wiki, deliberately unstated.',
    visual:
      'An ordinary room seen twice, overlaid: the present in warm light and a faint blue-white wireframe prediction of the same room a half-second ahead, a figure and their predicted next position both visible.',
    aspect: 'square_hd',
  },
  {
    name: 'BayBlitz Hack VII — The Win That Went Viral',
    kind: 'event',
    description:
      "The hackathon in the SOMA warehouse where Eli's demo did something the judges couldn't explain, the clip hit a million views overnight, and instead of opening doors it triggered the 'hackathon tourist' thread three days later. The show's clearest example of a win that made everything worse.",
    visual:
      "A hackathon warehouse stage mid-demo, a lone figure at a laptop under a single spotlight, the crowd's phones all up and recording, a projected screen behind him showing an impossible result.",
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Sand Hill Road Pitch',
    kind: 'event',
    description:
      'The meeting, early in the series, where Eli finally gets fifteen minutes with a top-tier firm and is laughed out of the room before the demo finishes loading — a partner checking his phone, an associate stifling a smile. He walks the length of Sand Hill Road afterward in the rain. It is the last time in the show he asks anyone for permission.',
    visual:
      'A glass VC conference room, a young man in a black hoodie standing at the head of the table mid-sentence, three partners in quarter-zips visibly disengaged, one glancing at a phone, grey light.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Different Door',
    kind: 'event',
    description:
      'The finale beat the whole synopsis builds to: with every institution that ignored him now competing to fund, acquire or recruit him, Eli declines all of it and leaves through an exit none of them control or understand — taking GHOSTLATTICE, Maya and Dev with him. The wiki entry stops there, on purpose.',
    visual:
      'A figure with a laptop bag walking away from camera down an empty sunlit street, back to a building whose glass doors are crowded with people trying to get out toward him, long morning shadow.',
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
  console.log('  E Combonator — wiki seed');
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

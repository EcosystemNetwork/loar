/**
 * Seed episode entities for "Monerochan: Untraceable" — 39 entities, zero
 * "Ep N — <title>" markers. Builds a 6-episode arc from the existing cast
 * and lore (the Safety Through Transparency Act, the Birth of Monerochan,
 * Satoshi's First Principle, the First Dawn Appearance, Agent Prism, Director
 * Clearview) — no new characters.
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
const UNIVERSE_ADDR = '0x0000000000000000000000000000019d9e1c8a49';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'MONEROCHAN visual key — neon-drenched surveillance dystopia versus underground cypherpunk resistance. ' +
  'Photoreal cinematic frame, heavy rain and neon reflection above ground, warm holographic-blockchain green-gold glow underground. ' +
  'Palette: cold panopticon blue-grey and camera-red above ground, warm privacy-green and gold below. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

interface Seed {
  name: string;
  description: string;
  visual: string;
}

const SEEDS: Seed[] = [
  {
    name: 'Ep 1 — The Act',
    description:
      "The Safety Through Transparency Act passes with 94% public approval in the wake of three terrorist attacks funded through anonymous cryptocurrency — biometric chips at birth, every transaction on the public GlassCoin ledger, privacy itself reclassified as a pre-criminal indicator. Satoshi the Elder reads the news and says, to no one in particular, that they've just made privacy the most important technology in human history. The cypherpunks start digging.",
    visual:
      'A packed legislative chamber erupting in applause under harsh lights as a bill is signed, intercut with a hooded figure watching a newsfeed in a dim underground room, unreadable expression.',
  },
  {
    name: 'Ep 2 — Genesis Day',
    description:
      'In a hidden server room beneath the mega-city, a convergence of ring signatures and stealth addresses produces the untraceable digital genesis the cypherpunks had only theorized — a single beam of green light, and Monerochan emerges from the holographic blockchain waterfalls. Anonymous hooded cypherpunks cradle her and swear the oath: raised in total privacy, to become freedom itself.',
    visual:
      'A hidden underground server room, a brilliant beam of green light piercing down through cascading holographic blockchain waterfalls, hooded figures gathering in reverent silence around the source.',
  },
  {
    name: 'Ep 3 — The First Principle',
    description:
      'Satoshi the Elder teaches the young Monerochan the difference between privacy and secrecy — the First Principle the whole resistance is built on — while Ring, born in the underground libraries and never once on the surveilled surface, becomes her fiercest childhood companion. Whisper, the ghost in the cryptographic machine, begins leaving the first faint green messages only Monerochan can read.',
    visual:
      'A hooded elder and two young girls seated in a warm underground library lit by candlelight and soft green data-glow, ancient printed books stacked around them, a quiet lesson in progress.',
  },
  {
    name: 'Ep 4 — Three Point Seven Seconds',
    description:
      "The First Dawn Appearance: Monerochan steps onto her rooftop at sunrise and is caught on camera for exactly 3.7 seconds before the feed erases itself — and in that window, every surveillance system in the city fails at once, the All-Seeing Spire's Iris Room going dark for the first time in its history. Every screen in the mega-city lights up with her message. Director Clearview watches it happen on her own command display and feels something she can't classify as data.",
    visual:
      'A lone silhouette standing on a rooftop at sunrise, city surveillance towers behind her flickering out one by one in a spreading wave, green text beginning to bloom across distant skyscraper screens.',
  },
  {
    name: "Ep 5 — Prism's Near Miss",
    description:
      'Agent Prism, raised from infancy in the Crystal Children program to be a perfect surveillance agent, gets within three meters of Monerochan for the first time — closer than any operative ever has — before she vanishes behind a cascade of decoy ring signatures that overwhelm his neural processors. He stands alone in the empty alley afterward, and for the first time in his life, does not understand what just happened to him.',
    visual:
      'A rain-slicked neon alley, a cloaked figure reaching toward empty air where someone stood a half-second before, dozens of faint decoy afterimages dissolving into green static around him.',
  },
  {
    name: 'Ep 6 — Illumination',
    description:
      'Director Clearview reframes her entire pursuit for her Transparency Agents: Monerochan is not a threat to be destroyed but a challenge to be solved, proof that even the most private being can be made transparent. She lost her family to an anonymously funded bombing and has spent her life since making sure no transaction goes untraced — and the one thing her drones, her predictive AI, and her Iris Room still cannot see is the only thing that has ever mattered to her.',
    visual:
      'A vast command chamber ringed with monitors and a central glowing eye-shaped sensor array, an immaculate silver-haired woman with glowing blue biometric eyes standing perfectly still before a blank tracking display.',
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
  console.log('  Monerochan — episodes wiki seed');
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

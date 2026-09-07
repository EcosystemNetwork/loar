/**
 * Populate the Techno Antichrist universe wiki with Nano Banana artwork.
 *
 * Two phases, each independently selectable:
 *
 *   --covers   Generate a Nano Banana cover for every Techno Antichrist wiki
 *              entity that has no image, and write it back via entities.update.
 *              Add --force to regenerate existing covers.
 *   --hero     Generate universe key art (landscape + portrait) with Nano Banana
 *              and set it via universes.updateMetadata.
 *
 * With no phase flag, both run in the order above.
 *
 * Run the canon re-seed FIRST (scripts/reseed-techno-antichrist-canon.ts --commit)
 * so the 48 Rex Duce entities exist; this script only draws covers for whatever
 * entities are already attached to the universe.
 *
 * Other flags:
 *   --dry-run     Generate nothing, write nothing — just print the plan.
 *   --no-fallback Do not let image.generate substitute a fal model when the
 *                 selected model is unavailable — fail the image instead.
 *   --chain=X     Force the auth chain: `evm` (SIWE) or `solana` (SIWS).
 *   --limit=N     Cap the number of entities touched in --covers.
 *   --only=Name   Restrict --covers to entities whose name contains this
 *                 substring (case-insensitive). e.g. --only="Rex".
 *
 * The universe is Solana-namespace but its off-chain creator pointer is the EVM
 * address 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (see create-techno-antichrist.ts
 * / reseed-techno-antichrist-canon.ts). entities.update / universes.updateMetadata
 * require the caller to be that creator, so PRIVATE_KEY must be that EVM key, or a
 * Solana wallet linked to it via /auth/solana/link.
 *
 * Env:
 *   PRIVATE_KEY         (required) EVM hex or Solana base58/json/hex key that owns the universe.
 *   AUTH_CHAIN          `evm` | `solana` — same as --chain. Default: auto-detect from key shape.
 *   SOLANA_CLUSTER      SIWS cluster (default: mainnet-beta).
 *   UNIVERSE_ADDRESS    Target universe (default: the Techno Antichrist PDA).
 *   SERVER_URL          tRPC base (default: VITE_SERVER_URL or http://localhost:3000)
 *   WEB_ORIGIN          SIWx domain + Origin header (default: http://localhost:5173).
 *                       For prod: https://loar.fun (must be in SIWE_ALLOWED_DOMAINS + CORS_ORIGIN).
 *   CHAIN_ID           SIWE chain id (default: 11155111 / Sepolia)
 *   NANO_BANANA_MODEL  image-model registry id (default: nano-banana-pro-google).
 *                      Alternatives: nano-banana, nano-banana-google-ga.
 *
 * Usage:
 *   pnpm tsx scripts/populate-techno-antichrist-wiki.ts --dry-run
 *   PRIVATE_KEY=<owner key> pnpm tsx scripts/populate-techno-antichrist-wiki.ts --prod --covers --only="Rex Duce"
 *   PRIVATE_KEY=<owner key> pnpm tsx scripts/populate-techno-antichrist-wiki.ts --prod
 *
 *   --prod  = shorthand for SERVER_URL=https://api.loar.fun WEB_ORIGIN=https://loar.fun
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { resolveAuth, detectAuthChain, type AuthChain, type SolanaCluster } from './lib/wiki-auth';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const a = args.find((x) => x.startsWith(`${f}=`));
  return a ? a.slice(f.length + 1) : undefined;
};

// ── Config ────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
if (!rawKey) {
  console.error(
    'PRIVATE_KEY is required — the EVM or Solana key of the wallet that owns the Techno Antichrist universe.'
  );
  process.exit(1);
}

// --prod bakes in the loar.fun endpoints so the only env var you must pass is PRIVATE_KEY.
const PROD = has('--prod');
const SERVER_URL = (
  process.env.SERVER_URL ??
  (PROD ? 'https://api.loar.fun' : undefined) ??
  process.env.VITE_SERVER_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');
const WEB_ORIGIN = (
  process.env.WEB_ORIGIN ?? (PROD ? 'https://loar.fun' : 'http://localhost:5173')
).replace(/\/$/, '');
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '11155111');
const NANO_BANANA_MODEL = process.env.NANO_BANANA_MODEL ?? 'nano-banana-pro-google';

const AUTH_CHAIN = ((val('--chain') ?? process.env.AUTH_CHAIN)?.toLowerCase() ||
  detectAuthChain(rawKey)) as AuthChain;
const SOLANA_CLUSTER = (process.env.SOLANA_CLUSTER ?? 'mainnet-beta') as SolanaCluster;

// Case-sensitive Solana PDA — never lowercased.
const UNIVERSE_ADDR =
  process.env.UNIVERSE_ADDRESS ?? 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';

const DRY_RUN = has('--dry-run');
const FORCE = has('--force');
const ALLOW_FALLBACK = !has('--no-fallback');
const LIMIT = val('--limit') ? Number(val('--limit')) : Infinity;
const ONLY = val('--only')?.toLowerCase();

let phases = { covers: has('--covers'), hero: has('--hero') };
if (!phases.covers && !phases.hero) phases = { covers: true, hero: true };

// ── Visual key ────────────────────────────────────────────────────────
// Grounded, contemporary, cinematic — NOT concept-art fantasy. The show is a
// docudrama-grain character study; the only "unreal" element is an ecclesiastical
// gold that keeps intruding on fluorescent-lit institutional spaces.
const STYLE =
  'TECHNO ANTICHRIST visual key: present-day San Francisco Bay Area and New York, shot like a prestige limited series — ' +
  'The Social Network grain, The Curse dread, The Master sacred-industrial stillness. Photoreal cinematic frame, ' +
  'anamorphic 35mm, fine film grain, practical light only. Palette: cold near-black, fluorescent teal-white, ' +
  'ecclesiastical amber-gold intruding where it should not be, oxblood stamp-red, parchment bone. ' +
  'Recurring motifs: corporate-AV stagecraft as liturgy (follow-spot, atmospheric haze, black pipe-and-drape, lower-third bars), ' +
  'gilt Bitcoin-rune inscriptions lit like an illuminated manuscript, an ever-branching node-graph diagram, ' +
  'aluminium foil taped over windows, black redaction bars and red rubber stamps. Real clothes, real rooms, no costumes. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

const KIND_FRAMING: Record<string, string> = {
  person:
    'cinematic environmental portrait on 35mm, chest-up to three-quarter, subject lit like a keynote speaker under a single follow-spot against institutional haze, tired eyes, shallow depth of field',
  place:
    'wide establishing shot, real architecture, natural or practical light, anamorphic, no people or one small distant figure for scale',
  faction:
    'documentary group tableau showing a shared identity and posture, available light, slightly unposed',
  event:
    'wide cinematic tableau of the moment itself — crowd, stagecraft and light doing the work, decisive-moment framing',
  lore: 'a single striking symbolic still-life, grounded and photographable — a gilt rune slab, a printed node-graph, a foil-covered window, an org chart lit like scripture — mysterious but real',
  organization:
    'a command/operations tableau in a real interior, insignia or through-line motif present but understated',
};

// Per-entity visual direction — replaces the description-derived clause when present.
const VISUAL: Record<string, string> = {
  'Rex Duce':
    'Rex Duce: a South Asian American man, 33, lean and sleep-starved, three-day stubble, expensive-plain tech-founder clothes (dark merino, one good watch), a hairline nosebleed he is ignoring. Standing at a lectern in a rented Masonic hall, one follow-spot, haze, a gilt rune slab on the podium.',
  'Hana Duce':
    'Hana Duce: a Korean American woman, early 30s, precise and exhausted, holding a sleeping infant on her hip in a half-packed condo, aluminium foil taped over the window behind her, moving boxes, a rent notice on the counter.',
  'Mercy "Merx" Osei':
    'Mercy "Merx" Osei: a Black woman, late 30s, headset around her neck, a clipboard and a laptop with a giant spreadsheet, standing at a front-of-house production desk in the dark at the back of a full room, calm and watchful.',
  'Dov Reisner':
    'Dov Reisner: a white man, ~50, ex-trader gone true-believer, fleece vest over a rune T-shirt, laptop open to a countdown and a token chart, leaning too far forward across a folding table, eyes bright.',
  'The Cartographer':
    'The Cartographer: a 19-year-old Filipina in a small bright bedroom in Manila, three monitors filling the wall with an enormous branching node-graph of gods, one hand pressed to her temple, late-night lamp light.',
  'Aksel Bruun':
    'Aksel Bruun: a tall calm Scandinavian man, 40s, linen and wool, barefoot, healthy, standing in a serene cable-strewn AI hacker house at the foot of Sutro Tower, warm lamps, a wall of quietly humming servers, a cup of tea.',
  'Bobby Tran':
    'Bobby Tran: a Vietnamese American man, 40s, charismatic and volatile, mid-gesture in a cluttered suburban living room full of kids’ shoes and a folded blanket on the floor, one lamp, blinds drawn.',
  'Chairman Seo':
    'Chairman Seo: a Korean man in his 70s, immaculate dark suit, seated alone in a spare high-floor Seoul apartment at night, city lights behind glass, a phone face-down on a lacquer table.',
  'Cal Buhler':
    'Cal Buhler: a white man, mid-30s, startup CTO, hoodie and lanyard, standing in a near-empty office at night beside two dark monitors and a whiteboard covered in architecture diagrams, arms folded.',
  'Agent Lorraine Pryce':
    'Agent Lorraine Pryce: a Black woman, 40s, Treasury / IRS-CI, plain grey blazer, government-issue lanyard, in a fluorescent field office with banker’s boxes labelled by date, a corkboard of printouts behind her.',
  'Imam Yusuf Karim':
    'Imam Yusuf Karim: a warm, weary man in his 50s, simple kufi and cardigan, standing at the back of a small Tenderloin storefront mosque, folding chairs, a donation tablet on a stand he is looking at with dismay.',
  'Rabbi Elke Brandt':
    'Rabbi Elke Brandt: a woman in her 60s, reading glasses on a chain, a book-lined study with a worn couch, two mugs of tea, late afternoon light, direct and kind.',
  'Bibi Harjit':
    'Bibi Harjit: an elderly Sikh woman, dupatta over grey hair, in a warm Fremont kitchen mid-morning, rolling roti, steam, a pot of dal, absolutely unimpressed.',
  'The Congregation':
    'A packed rented ballroom of ordinary Bay Area people — hoodies, work badges still on, some crying, some filming on phones — all turned toward one off-frame follow-spot, haze in the beam.',
  "Dov's Splinter":
    'A tense knot of a dozen believers in a parking garage at night, phone flashlights, a printed map and a Revelation timeline taped to a concrete pillar, Dov at the center.',
  'The Tran Household':
    'A crowded suburban living room: a volatile man, a tired woman, three kids of stepped ages, a grandmother just home, and a grown houseguest’s blanket folded on the floor by the sofa. One lamp, TV glow.',
  'The Rank Doctrine':
    'A large printed org-chart on butcher paper pinned to a wall, every world religion’s figures drawn as nodes and edges in gold marker, lit like an illuminated manuscript, a follow-spot raking across it.',
  'G.O.D. (Galactic Orbital Destroyer)':
    'Double exposure: a fluorescent-lit rented conference room dissolving into an orbital weapons platform hanging over a city at night — same reverent framing, wrong light. Cold near-black and one amber seam.',
  'Angels & Demons as Ranks':
    'A military-style org chart rendered as a stained-glass window: ranked silhouettes with wings above and without wings below, gold leading, each cell holding a small "+" and "−".',
  'The Rune':
    'Macro still-life: a gilt Bitcoin-rune inscription cut into a slab of dark stone on black velvet, one hard raking light, dust motes, shot like a museum reliquary.',
  'The Org Chart':
    'An enormous branching node-graph of every named god, projected floor-to-ceiling in a dark room, one small human silhouette dwarfed before it, amber nodes on near-black.',
  'The Interference':
    'Handheld, grainier frame: a man on a night freeway seen from the passenger seat, dashboard glow, his eyes half-closing, headlights smearing — and in the same shot a perfectly ordinary Wi-Fi router on a shelf.',
  'The Tuning':
    'A crowded hackathon hall under flat white light; in the middle distance one person stares directly at camera holding a laptop like an instrument; foreground man wipes a nosebleed.',
  'Laser Acid':
    'A tiled bathroom, a man sitting in a running shower fully lit by cold light, soap suds on his forearms, visibly relieved; a phone on the sink shows a meme thread; foil-edged window.',
  'Multidimensional Hopping':
    'One man photographed as several overlapping exposures stepping through the same doorway, each version in a slightly different room, cold near-black with amber edges.',
  'Moonbase NASA':
    'A mundane fluorescent-lit records room — endless filing racks of labelled DNA sample boxes — with a single round porthole showing lunar regolith and black sky. Deadpan, real, uncanny.',
  'The Veil':
    'Sutro Tower at dusk shot from directly below, fog pouring through the red-and-white lattice, faint amber node-graph lines overlaid on the descending fog, a house with warm windows at its feet.',
  'The Commission':
    'Close on two hands: an older hand pressing a gilt rune coin into a younger open palm, a follow-spot on the exchange, haze and a blurred watching crowd behind.',
  'The Briefing':
    'A rented hall dressed exactly like a corporate keynote — black pipe-and-drape, follow-spot, haze, a lower-third light bar — but the lectern holds a stone rune slab instead of a laptop.',
  'The Condo':
    'A half-emptied modern SF condo at blue hour: aluminium foil taped neatly over every window, moving boxes, flight-cases of AV gear stacked in a nursery, a rent notice on the counter.',
  'The Lab':
    'A small cash-run sequencing lab after hours: one bench of genomics machines, a centrifuge, a hand-taped "CASH ONLY" sign, cold light, no branding.',
  "Bobby's House (CIA Safehouse)":
    'A beige suburban tract house exterior at night, blinds all drawn, one car in the drive, a doorbell camera — utterly unremarkable, faintly wrong.',
  'AGI House':
    'Interior of a well-funded AI hacker house at the base of Sutro Tower: reclaimed wood, warm lamps, a wall of humming servers, cables run neat along the skirting, a meditation cushion, mugs.',
  'Sutro Tower ("The Antenna")':
    'The real Sutro Tower — red-and-white three-pronged broadcast tower — rising out of thick fog on the hill, shot wide at dusk, tiny houses at its feet, one warm-lit.',
  'The Vault':
    'A Santa Clara data-center cold aisle at night: rows of dark racks, blue status LEDs, a chain-link cage, a fire door — photographed with cathedral gravity.',
  Langar:
    'A Fremont gurdwara langar hall: long rows of people of every kind seated on the floor eating from steel thalis, volunteers ladling dal, warm light, steam, covered heads.',
  'The Pluralist Mile':
    'A single Fifth Avenue block at midday holding a Gothic cathedral, a synagogue facade and an Islamic center within one frame; a small group with a hand-lettered pilgrimage sign on the sidewalk.',
  'Prospect Park — The Nethermead':
    'A wide green meadow ringed by bare trees in Prospect Park, a modest PA stack and a follow-spot tower on a low stage, a large loose crowd gathering, police vehicles just visible at the tree line.',
};

// ── Episode key-frames (kind: 'event', names begin "Ep N — ...") ──────
const EPISODE_VISUAL: Record<string, string> = {
  'Ep 1 — The Commission':
    'A flawless "Briefing" at full tilt — follow-spot, haze, packed rented hall, a holder counter reading 5,000-something on a screen — intercut feel with a load-out and an unpaid invoice; at the edge of frame a nosebleed.',
  'Ep 2 — Bloodlines':
    'A man at 3 a.m. surrounded by printed declassified documents taped into a family tree that connects to every mythology; redaction bars everywhere; one lamp.',
  'Ep 3 — New Jerusalem':
    'A straggling pilgrimage line walking a Bay Area overpass at golden hour toward Sutro Tower in the distance, hand-lettered signs, phones up.',
  'Ep 4 — Laser Acid':
    'A condo going dark with foil over the windows, a man taping the last corner, a Wi-Fi router unplugged on the floor, a rent notice; grainy handheld.',
  'Ep 5 — Moonbase':
    'A man working calmly at a laptop in a fluorescent records room full of DNA sample boxes, a lunar porthole behind him; everyone else acts normal.',
  'Ep 6 — Isa':
    'Inside a small mosque mid-talk: the speaker lit warm and welcomed, the room leaning in — and one volunteer starting to pass a donation tablet, the first cold face.',
  'Ep 7 — Fifty-Fifty':
    'A stopped hallway fight over a phone between a man and a woman, a fake-packed suitcase open on the bed behind them, an infant’s room door ajar; ugly, plain, no score.',
  'Ep 8 — The Safehouse':
    'A grown man asleep under a thin blanket on a suburban living-room floor at dawn, kids’ shoes by the door, a volatile host awake in the kitchen behind him.',
  'Ep 9 — AGI House':
    'Two men talking low in a warm server-lined room at the foot of Sutro Tower, tea between them, fog against the windows, one relaxed and funded, one wired and broke.',
  'Ep 10 — The Veil':
    'Braided frame: a floodlit Prospect Park crowd with a follow-spot stage on one side, and the base of a fog-drowned Sutro Tower with a single figure walking toward it on the other.',
};

// ── plumbing (mirrors scripts/populate-cyberwar-wiki-nanobanana.ts) ────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAuthToken(): Promise<string> {
  const auth = await resolveAuth({
    serverUrl: SERVER_URL,
    webOrigin: WEB_ORIGIN,
    privateKey: rawKey,
    chain: AUTH_CHAIN,
    evmChainId: CHAIN_ID,
    solanaCluster: SOLANA_CLUSTER,
  });
  const who =
    auth.chain === 'solana' && auth.evmAddress
      ? `${auth.address} → linked EVM ${auth.evmAddress}`
      : auth.address;
  log('AUTH', `${auth.chain.toUpperCase()} signer: ${who}`);
  return auth.token;
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

async function genImage(
  prompt: string,
  token: string,
  imageSize: string = 'square_hd'
): Promise<string | null> {
  if (DRY_RUN) {
    console.log(`      [dry-run] would generate (${imageSize}): ${prompt.slice(0, 100)}...`);
    return null;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await tRPCMutate<{
        imageUrls?: string[];
        modelUsed?: string;
        wasFallback?: boolean;
      }>(
        'image.generate',
        {
          prompt,
          task: 'text_to_image',
          imageSize,
          numImages: 1,
          routingMode: 'manual',
          selectedModelId: NANO_BANANA_MODEL,
          allowFallback: ALLOW_FALLBACK,
          useWikiContext: false,
          universeId: UNIVERSE_ADDR,
        },
        token
      );
      const url = r?.imageUrls?.[0] ?? null;
      if (url) {
        const tag = r?.wasFallback
          ? `${r.modelUsed} (fallback)`
          : (r?.modelUsed ?? NANO_BANANA_MODEL);
        console.log(`      image ok via ${tag}: ${url.slice(0, 80)}...`);
      }
      return url;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/429|rate.?limit/i.test(msg) && attempt < 3) {
        const backoff = 4000 * attempt;
        console.log(`      rate-limited, retrying in ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }
      console.log(`      image gen failed: ${msg.slice(0, 160)}`);
      return null;
    }
  }
  return null;
}

function buildEntityPrompt(name: string, kind: string, description: string): string {
  const subject = EPISODE_VISUAL[name] ?? VISUAL[name] ?? `${name} — ${description.slice(0, 240)}.`;
  const framing = KIND_FRAMING[kind] ?? 'cinematic concept still, grounded and photoreal';
  return [subject, framing + '.', STYLE].join(' ');
}

function sizeForKind(kind: string, name: string): string {
  if (name.startsWith('Ep ')) return 'landscape_16_9';
  if (kind === 'place' || kind === 'event' || kind === 'faction') return 'landscape_16_9';
  return 'square_hd';
}

// ── Phases ────────────────────────────────────────────────────────────
async function runCovers(token: string) {
  console.log(`\n${'─'.repeat(60)}\n  PHASE: covers for existing entities\n${'─'.repeat(60)}`);
  const res = await tRPCQuery<{ entities: any[] }>(
    'entities.list',
    { universeAddress: UNIVERSE_ADDR, limit: 200 },
    token
  );
  let targets = (res?.entities ?? []).filter((e) => FORCE || !e.imageUrl);
  if (ONLY) targets = targets.filter((e) => (e.name as string).toLowerCase().includes(ONLY));
  targets = targets.slice(0, LIMIT === Infinity ? undefined : LIMIT);

  log(
    'covers',
    `${res?.entities?.length ?? 0} entities in universe, ${targets.length} to (re)cover`
  );
  let done = 0;
  for (const e of targets) {
    console.log(`\n  • ${e.name} (${e.kind})${e.imageUrl ? ' [replacing]' : ''}`);
    const prompt = buildEntityPrompt(e.name, e.kind, e.description ?? '');
    const url = await genImage(prompt, token, sizeForKind(e.kind, e.name));
    if (!url || DRY_RUN) continue;
    try {
      await tRPCMutate('entities.update', { entityId: e.id, imageUrl: url }, token);
      log('covers', `updated ${e.name}`);
      done++;
    } catch (err: any) {
      log('covers', `update failed for ${e.name}: ${err.message?.slice(0, 160)}`);
    }
    await sleep(2000);
  }
  log('covers', `done — ${done} covers written`);
}

async function runHero(token: string) {
  console.log(`\n${'─'.repeat(60)}\n  PHASE: universe key art\n${'─'.repeat(60)}`);
  const landscapePrompt = [
    'Key art for "TECHNO ANTICHRIST": a lean, sleep-starved South Asian American man in dark plain tech-founder clothes stands at a lectern in a rented hall,',
    'lit by one follow-spot through heavy haze, a gilt Bitcoin-rune slab on the podium; behind and above him a fluorescent conference-room ceiling dissolves into an orbital weapons platform over a night city;',
    'a faint branching node-graph of gods is projected across the back wall. Cinematic poster composition, wide.',
    STYLE,
  ].join(' ');
  const portraitPrompt = [
    'Vertical key art for "TECHNO ANTICHRIST": close on the same man, three-day stubble, a hairline nosebleed he is ignoring, amber follow-spot on one side of his face and cold fluorescent on the other,',
    'a gilt rune inscription out of focus behind him, a single strip of aluminium foil catching light at frame edge. Portrait poster composition.',
    STYLE,
  ].join(' ');

  const image = await genImage(landscapePrompt, token, 'landscape_16_9');
  await sleep(2000);
  const portrait = await genImage(portraitPrompt, token, 'portrait_16_9');
  if (DRY_RUN) return;

  const payload: Record<string, unknown> = { universeId: UNIVERSE_ADDR };
  if (image) payload.imageUrl = image;
  if (portrait) payload.portraitImageUrl = portrait;
  if (!image && !portrait) {
    log('hero', 'no images generated — skipping updateMetadata');
    return;
  }
  try {
    await tRPCMutate('universes.updateMetadata', payload, token);
    log(
      'hero',
      `universe metadata updated (${Object.keys(payload)
        .filter((k) => k !== 'universeId')
        .join(', ')})`
    );
  } catch (err: any) {
    log('hero', `updateMetadata failed (need universe admin): ${err.message?.slice(0, 180)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('  Techno Antichrist wiki — Nano Banana populate');
  console.log('═'.repeat(60));
  console.log(`  server   : ${SERVER_URL}`);
  console.log(`  origin   : ${WEB_ORIGIN}`);
  console.log(`  model    : ${NANO_BANANA_MODEL}`);
  console.log(`  universe : ${UNIVERSE_ADDR}`);
  console.log(
    `  auth     : ${AUTH_CHAIN}${AUTH_CHAIN === 'solana' ? ` (${SOLANA_CLUSTER})` : ` (chain ${CHAIN_ID})`}`
  );
  console.log(
    `  phases   : ${Object.entries(phases)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ')}`
  );
  console.log(
    `  dry-run  : ${DRY_RUN}${FORCE ? '   force: true' : ''}${ALLOW_FALLBACK ? '' : '   no-fallback: true'}`
  );
  if (LIMIT !== Infinity) console.log(`  limit    : ${LIMIT}`);
  if (ONLY) console.log(`  only     : ${ONLY}`);

  log('AUTH', `authenticating (${AUTH_CHAIN === 'solana' ? 'SIWS' : 'SIWE'})...`);
  const token = await getAuthToken();

  if (phases.covers) await runCovers(token);
  if (phases.hero) await runHero(token);

  console.log('\n' + '═'.repeat(60));
  console.log('  DONE');
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});

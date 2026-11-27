/**
 * Greenwood Outlaws — seed the wiki and the prototype NFT characters.
 *
 * Creates, in an existing universe (see scripts/create-greenwood-universe.ts):
 *   - world entities: places, factions and the named lore characters (full costume)
 *   - 8 SAMPLE outlaws: the NFT base look. Linen smallclothes only, barefoot,
 *     A-pose, one per body type and sex (docs/universes/greenwood/BIBLE.md §5)
 *
 * Re-runnable: entities that already exist (same name in the universe) are skipped.
 *
 * Usage:
 *   GREENWOOD_UNIVERSE=0x… pnpm tsx scripts/seed-greenwood-wiki.ts [--only=world|samples] [--puppet]
 *
 *   --puppet  also start a Tripo character-puppet job (T-pose → turnaround → mesh →
 *             biped rig → default clips) for every sample. Needs a Tripo key on the
 *             account; uses paid Tripo credits.
 *
 * Required env: PRIVATE_KEY (universe owner), GREENWOOD_UNIVERSE
 * Optional env: VITE_SERVER_URL (default http://localhost:3000)
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const UNIVERSE_ADDR = process.env.GREENWOOD_UNIVERSE ?? '';
const account = privateKeyToAccount(PRIVATE_KEY);

const args = process.argv.slice(2);
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1] as
  | 'world'
  | 'samples'
  | undefined;
const PUPPET = args.includes('--puppet');

type Kind = 'person' | 'place' | 'faction' | 'organization' | 'lore';

interface Seed {
  name: string;
  kind: Kind;
  description: string;
  imagePrompt: string;
  metadata?: Record<string, unknown>;
}

const STYLE =
  'Stylized hand-painted medieval fantasy game art, warm greens and golds, soft natural light, clean readable shapes, no text, no watermark.';

// ── World: places, factions, named characters ─────────────────────────
const WORLD: Seed[] = [
  {
    name: 'The Greenwood',
    kind: 'place',
    description:
      "An ancient forest at the heart of Aldmere, older than the kingdom. The Sheriff's men fear its paths; the stripped and the outlawed call it home. The game's hub region.",
    imagePrompt: `Vast ancient oak forest, golden light shafts through the canopy, mossy paths, hidden rope bridges between giant trees, drifting pollen. ${STYLE}`,
  },
  {
    name: 'The Hollow Oak',
    kind: 'place',
    description:
      'A colossal hollow oak deep in the Greenwood, the outlaw camp. Lantern-lit platforms, a cookfire, and the stash where every piece of gear taken back from the Sheriff is kept.',
    imagePrompt: `A colossal hollow oak tree turned into an outlaw camp, lanterns, wooden platforms and ladders, cookfire smoke, racks of bows and stolen armour, dusk. ${STYLE}`,
  },
  {
    name: 'Thornbury Keep',
    kind: 'place',
    description:
      "The Sheriff's stone castle and counting-house, where the Stripping Tithe is stored: chests of coin, heaps of seized boots, cloaks and tools. The final raid.",
    imagePrompt: `Imposing grey stone castle on a hill, crimson banners, iron portcullis, a counting-house tower, tax carts lined up at the gate, overcast sky. ${STYLE}`,
  },
  {
    name: 'Kingsroad',
    kind: 'place',
    description:
      'The dirt road that cuts through the Greenwood, carrying tax convoys from the villages to Thornbury Keep. Ambush country.',
    imagePrompt: `Dirt road winding through dense forest, a red-bannered tax wagon with armoured guards, archers hidden in the leaves above. ${STYLE}`,
  },
  {
    name: 'Millbrook',
    kind: 'place',
    description:
      'A poor village of thatched cottages and a watermill, bled dry by the Tithe. The outlaws protect it; quest hub and market.',
    imagePrompt: `Small medieval village, thatched cottages, a creaking watermill, muddy lanes, villagers in patched clothes, gentle morning light. ${STYLE}`,
  },
  {
    name: 'The Weir',
    kind: 'place',
    description:
      'A narrow log bridge over a river weir. Only one can cross at a time, which makes it the place where outlaws settle disputes with quarterstaffs.',
    imagePrompt: `Narrow log bridge across a foaming river weir in a forest clearing, mossy stones, morning mist. ${STYLE}`,
  },
  {
    name: 'The Greenwood Outlaws',
    kind: 'faction',
    description:
      'Everyone the Sheriff stripped and drove out. They rob the tax convoys and give the coin back to the villages. Every member arrived with nothing but their linen; everything they wear was taken back. The NFT holders.',
    imagePrompt: `A crest: a green oak leaf crossed by an arrow on a brown linen banner. ${STYLE}`,
  },
  {
    name: "The Sheriff's Tithe-Men",
    kind: 'faction',
    description:
      'Tax collectors and soldiers in crimson tabards and iron caps who enforce the Stripping Tithe. They carry ledgers, chains and halberds. The main enemy faction.',
    imagePrompt: `A squad of medieval soldiers in crimson tabards and iron kettle helmets with halberds, a clerk holding a ledger. ${STYLE}`,
  },
  {
    name: 'Abbey of St. Wendel',
    kind: 'organization',
    description:
      'A wealthy monastery that blesses the Tithe and quietly takes a share. Its cellars hold more gold than the villages have seen in a generation. A raid target.',
    imagePrompt: `Rich stone abbey with stained glass, plump monks counting gold coins by candlelight in a cellar. ${STYLE}`,
  },
  {
    name: 'Wren Ashby',
    kind: 'person',
    description:
      'Captain of the Greenwood Outlaws and the finest archer in Aldmere. The first person ever stripped under the Tithe, for speaking back to the Sheriff in Millbrook square. Quick-witted, reckless, fiercely loyal.',
    imagePrompt: `Young woman outlaw captain, lean archer build, cropped auburn hair, freckles, green hooded cloak and leather jerkin, longbow, confident half-smile, forest background. ${STYLE}`,
  },
  {
    name: 'Big Tobin',
    kind: 'person',
    description:
      "A giant of a man with a quarterstaff and a soft heart. Lost his smithy to the Tithe. Wren's right hand; nobody crosses the Weir while he holds it.",
    imagePrompt: `Huge broad-shouldered bearded man, gentle eyes, holding a long quarterstaff, patched brown tunic, standing on a log bridge. ${STYLE}`,
  },
  {
    name: 'Brother Aldo',
    kind: 'person',
    description:
      "A stout runaway friar who walked out of the Abbey of St. Wendel with its secret ledgers. The camp's cook, medic and worst-kept secret.",
    imagePrompt: `Stout jolly friar with tonsure, brown habit, rope belt, ladle in one hand and a ledger book under his arm, cookfire. ${STYLE}`,
  },
  {
    name: 'Mira Fenn',
    kind: 'person',
    description:
      "A small, wiry tracker and lockpick who grew up poaching the king's deer. Can open any strongbox on a tax wagon before the guards turn around.",
    imagePrompt: `Small wiry young woman, dark braided hair, sharp eyes, dark green hood, lockpicks between her fingers, crouching on a branch. ${STYLE}`,
  },
  {
    name: 'Sheriff Morcant Vell',
    kind: 'person',
    description:
      "Ruler of Aldmere in the king's absence and inventor of the Stripping Tithe. Thin, precise and smiling. Keeps a ledger of every debt, and every outlaw's name.",
    imagePrompt: `Thin sharp-featured man in a black and crimson doublet with a gold chain of office, holding a quill over a ledger, cold smile, castle hall. ${STYLE}`,
  },
  {
    name: 'Sir Garrick Thorne',
    kind: 'person',
    description:
      "The Sheriff's champion: a towering knight in blackened plate who hunts outlaws for sport and keeps their stolen bows as trophies.",
    imagePrompt: `Towering knight in blackened plate armour with a thorned helm crest, longsword, crimson cape, menacing stance. ${STYLE}`,
  },
];

// ── Samples: the NFT base look ────────────────────────────────────────
const SMALLCLOTHES =
  'wearing ONLY plain undyed off-white linen smallclothes: fitted mid-thigh linen braies with a drawstring waist and a fitted sleeveless linen undershirt tucked in. Barefoot. No belt, no jewellery, no hood, no cloak, no weapon, no bag, no accessories';
const POSE =
  'Full body from head to bare feet, standing in a neutral A-pose with arms held about 45 degrees away from the body, feet shoulder-width apart, facing the camera, neutral expression, plain light grey studio background, even lighting';
const SAMPLE_STYLE =
  'Stylized 3D game character, hand-painted textures, clean readable silhouette, character turnaround reference quality, no text, no watermark';

interface Sample {
  name: string;
  bodyType: 'Archer' | 'Brawler' | 'Rogue' | 'Friar' | 'Ranger';
  sex: 'male' | 'female';
  build: string;
  traits: {
    skin: string;
    hair: string;
    facialHair: string;
    eyes: string;
    marks: string;
    dye: string;
  };
}

const SAMPLES: Sample[] = [
  {
    name: 'Outlaw #001 (Archer, f)',
    bodyType: 'Archer',
    sex: 'female',
    build: 'young woman, lean athletic archer build, average height',
    traits: {
      skin: 'light olive',
      hair: 'tied-back tail, chestnut',
      facialHair: 'none',
      eyes: 'green',
      marks: 'freckles',
      dye: 'undyed',
    },
  },
  {
    name: 'Outlaw #002 (Archer, m)',
    bodyType: 'Archer',
    sex: 'male',
    build: 'young man, lean athletic archer build, average height',
    traits: {
      skin: 'deep brown',
      hair: 'short curls, black',
      facialHair: 'stubble',
      eyes: 'brown',
      marks: 'none',
      dye: 'undyed',
    },
  },
  {
    name: 'Outlaw #003 (Brawler, m)',
    bodyType: 'Brawler',
    sex: 'male',
    build: 'big man, broad heavy muscular brawler build, tall, thick arms and neck',
    traits: {
      skin: 'fair, ruddy',
      hair: 'shaved',
      facialHair: 'short beard, red',
      eyes: 'blue',
      marks: 'scar across the eyebrow',
      dye: 'madder red',
    },
  },
  {
    name: 'Outlaw #004 (Brawler, f)',
    bodyType: 'Brawler',
    sex: 'female',
    build: 'strong woman, broad heavy muscular brawler build, tall, powerful shoulders',
    traits: {
      skin: 'medium brown',
      hair: 'braided crown, dark brown',
      facialHair: 'none',
      eyes: 'hazel',
      marks: 'woad tattoo on the upper arm',
      dye: 'undyed',
    },
  },
  {
    name: 'Outlaw #005 (Rogue, f)',
    bodyType: 'Rogue',
    sex: 'female',
    build: 'young woman, slight wiry rogue build, short',
    traits: {
      skin: 'pale',
      hair: 'cropped, jet black',
      facialHair: 'none',
      eyes: 'grey',
      marks: 'Tithe brand on the shoulder (rare)',
      dye: 'black (rare)',
    },
  },
  {
    name: 'Outlaw #006 (Rogue, m)',
    bodyType: 'Rogue',
    sex: 'male',
    build: 'young man, slight wiry rogue build, short',
    traits: {
      skin: 'tan',
      hair: 'tied-back tail, dark blond',
      facialHair: 'moustache',
      eyes: 'odd-eyed, one blue one brown (rare)',
      marks: 'none',
      dye: 'faded green',
    },
  },
  {
    name: 'Outlaw #007 (Friar, m)',
    bodyType: 'Friar',
    sex: 'male',
    build:
      'middle-aged man, stout round friar build with a big belly and strong arms, short-average height',
    traits: {
      skin: 'warm brown',
      hair: 'bald',
      facialHair: 'short beard, grey',
      eyes: 'brown',
      marks: 'none',
      dye: 'woad blue',
    },
  },
  {
    name: 'Outlaw #008 (Ranger, f)',
    bodyType: 'Ranger',
    sex: 'female',
    build: 'woman, tall long-limbed rangy ranger build',
    traits: {
      skin: 'deep brown',
      hair: 'braided crown, black',
      facialHair: 'none',
      eyes: 'amber',
      marks: 'freckles',
      dye: 'gold-trim (legendary)',
    },
  },
];

function sampleSeed(s: Sample): Seed {
  const t = s.traits;
  const looks = [
    `${t.skin} skin`,
    `hair: ${t.hair} (kept close to the head)`,
    t.facialHair !== 'none' ? `facial hair: ${t.facialHair}` : null,
    `${t.eyes} eyes`,
    t.marks !== 'none' ? t.marks : null,
  ]
    .filter(Boolean)
    .join(', ');
  const dye = t.dye.replace(/ \(.*\)$/, '');
  const clothes =
    dye === 'undyed' ? SMALLCLOTHES : SMALLCLOTHES.replace('undyed off-white', `${dye}-dyed`);
  return {
    name: s.name,
    kind: 'person',
    description: `Greenwood Outlaws genesis sample, ${s.bodyType} body type (${s.sex}). Stripped by the Tithe and arrived in the Greenwood with nothing but their linen; no equipment yet. Traits: ${looks}; smallclothes dye: ${t.dye}.`,
    imagePrompt: `Medieval outlaw, ${s.build}, ${looks}, ${clothes}. ${POSE}. ${SAMPLE_STYLE}.`,
    metadata: {
      collection: 'Greenwood Outlaws Genesis',
      sample: true,
      bodyType: s.bodyType,
      sex: s.sex,
      role: `${s.bodyType} (base body)`,
      traits: t,
      equipment: [],
    },
  };
}

// ── Auth + tRPC helpers ───────────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

function buildSiweMessage(params: { address: string; nonce: string; chainId: number }): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `localhost wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:5173`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = buildSiweMessage({
    address: getAddress(account.address),
    nonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message, signature }),
  });
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/siwe-session=([^;]+)/);
  if (!match) throw new Error('No session cookie');
  return match[1];
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
  const qs = encodeURIComponent(JSON.stringify({ '0': input }));
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1&input=${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 400)}`);
  return json[0]?.result?.data;
}

async function existingEntities(
  token: string
): Promise<Map<string, { id: string; imageUrl?: string }>> {
  const out = new Map<string, { id: string; imageUrl?: string }>();
  let cursor: string | undefined;
  do {
    const page = await tRPCQuery<{ entities: any[]; nextCursor: string | null }>(
      'entities.list',
      { universeAddress: UNIVERSE_ADDR, limit: 200, ...(cursor ? { cursor } : {}) },
      token
    );
    for (const e of page.entities) out.set(e.name, { id: e.id, imageUrl: e.imageUrl });
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

async function generateArt(seed: Seed, label: string, token: string): Promise<string | null> {
  try {
    log(label, 'Generating 2D art...');
    const img = await tRPCMutate<{
      imageUrls?: string[];
      images?: Array<{ url: string }>;
      url?: string;
    }>(
      'image.generate',
      {
        prompt: seed.imagePrompt,
        task: 'text_to_image',
        // Samples need head-to-feet framing for the T-pose / turnaround steps.
        imageSize: seed.metadata?.sample ? 'portrait_16_9' : 'square_hd',
        numImages: 1,
        routingMode: 'auto',
        qualityTarget: 'premium',
        universeId: UNIVERSE_ADDR,
      },
      token
    );
    const url = img?.imageUrls?.[0] || img?.images?.[0]?.url || img?.url || null;
    log(label, url ? `Art: ${url.slice(0, 80)}...` : 'No image URL returned');
    return url;
  } catch (err: any) {
    log(label, `Art failed: ${err.message?.slice(0, 150)}`);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  if (!/^0x[0-9a-fA-F]{40}$/.test(UNIVERSE_ADDR)) {
    throw new Error(
      'Set GREENWOOD_UNIVERSE to the universe address (run create-greenwood-universe.ts first)'
    );
  }
  console.log('='.repeat(60));
  console.log('  Greenwood Outlaws — seed wiki + genesis samples');
  console.log('='.repeat(60));
  console.log(`  Universe: ${UNIVERSE_ADDR}`);
  console.log(`  Server:   ${SERVER_URL}`);
  console.log(`  Scope:    ${ONLY ?? 'world + samples'}${PUPPET ? ' + Tripo puppets' : ''}\n`);

  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);
  const existing = await existingEntities(token);
  log('AUTH', `${existing.size} entities already in the universe`);

  const seeds: Seed[] = [
    ...(ONLY === 'samples' ? [] : WORLD),
    ...(ONLY === 'world' ? [] : SAMPLES.map(sampleSeed)),
  ];
  const samples: { name: string; id: string; imageUrl: string | null }[] = [];

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const label = `${i + 1}/${seeds.length}`;
    console.log(`\n--- ${seed.name} (${seed.kind}) [${label}] ---`);

    const found = existing.get(seed.name);
    if (found) {
      log(label, `Exists (${found.id}), skipping`);
      if (seed.metadata?.sample)
        samples.push({ name: seed.name, id: found.id, imageUrl: found.imageUrl ?? null });
      continue;
    }

    const imageUrl = await generateArt(seed, label, token);
    try {
      const result = await tRPCMutate<{ id: string }>(
        'entities.create',
        {
          name: seed.name,
          description: seed.description,
          kind: seed.kind,
          universeAddress: UNIVERSE_ADDR,
          imageUrl: imageUrl || undefined,
          metadata: seed.metadata,
          monetized: false,
          rightsDeclaration: 'original',
        },
        token
      );
      log(label, `Created: ${result?.id}`);
      if (seed.metadata?.sample) samples.push({ name: seed.name, id: result.id, imageUrl });
    } catch (err: any) {
      log(label, `Create failed: ${err.message?.slice(0, 200)}`);
    }
  }

  if (PUPPET) {
    console.log('\n--- Tripo puppets (T-pose → turnaround → mesh → rig → clips) ---');
    for (const s of samples) {
      if (!s.imageUrl) {
        log('PUPPET', `${s.name}: no art, skipped`);
        continue;
      }
      try {
        const job = await tRPCMutate<{ jobId?: string; id?: string }>(
          'tripo.characterPuppet',
          { entityId: s.id, rigType: 'biped' },
          token
        );
        log('PUPPET', `${s.name}: job ${job?.jobId ?? job?.id ?? '(started)'}`);
      } catch (err: any) {
        log('PUPPET', `${s.name}: ${err.message?.slice(0, 200)}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`  Done. ${samples.length} genesis samples in the universe.`);
  console.log(`  Canvas:  /universe/${UNIVERSE_ADDR}  (Cast strip)`);
  console.log(`  Studio:  /studio/characters?universe=${UNIVERSE_ADDR}`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('FAILED:', err.message ?? err);
  process.exit(1);
});

/**
 * Generate Orange Pills video with Google Veo 3.1 DIRECTLY (AI Studio API),
 * host on LOAR Firebase Storage, and attach as mediaAttachments so clips show
 * on the wiki Media tabs. No dependency on the deployed api.loar.fun.
 *
 * Modeled on gen-techno-antichrist-video.ts — see that file for the fuller
 * design notes. Run through `railway run --service loar --` for the injected
 * GOOGLE_API_KEY + Firebase Admin/Storage creds (or set GEN_GOOGLE_KEY from
 * ~/.config/loar/ta-video-key.env to use a second AI Studio key for fresh
 * Veo quota — that key isn't Techno-Antichrist-specific, it's just a spare).
 *
 *   railway run --service loar -- pnpm tsx scripts/gen-orange-pills-video.ts --live --dry-run
 *   railway run --service loar -- pnpm tsx scripts/gen-orange-pills-video.ts --live --motion --parallel=10
 *   railway run --service loar -- pnpm tsx scripts/gen-orange-pills-video.ts --live --nodes --parallel=10
 *   railway run --service loar -- pnpm tsx scripts/gen-orange-pills-video.ts --live --trailer --parallel=10
 *
 * Phases (default: --motion):
 *   --motion    image-to-video off every entity's cover — the wiki comes alive
 *   --episodes  a multi-shot animatic per "Ep N — …" episode (text-to-video)
 *   --trailer   a teaser attached to the universe
 *   --nodes     one chained offChainNodes sequence per episode (independent of
 *               each other, so --parallel runs multiple episodes at once; reuses
 *               existing animatic clips, generates only the gaps) + episodes docs.
 *               Missing "Ep N — …" wiki entities are created on the fly.
 *
 * Flags:
 *   --live          ignore a local .env FIRESTORE_EMULATOR_HOST
 *   --dry-run       print the plan + prompts, generate nothing
 *   --force         redo items that already have a video attachment
 *   --only=Sub      restrict --motion to entities whose name contains Sub
 *   --kind=k        restrict --motion to a kind (person|place|lore|event|faction)
 *   --limit=N       cap items
 *   --max=N         stop after this many successful clips this run (resumable)
 *   --model=ID      Google Veo *registry* id (default veo-31-fast-preview-google;
 *                   others: veo-31-preview-google, veo-31-lite-preview-google,
 *                   veo-30-google, veo-30-fast-google). dispatchGoogleVeo
 *                   auto-falls-back down the Google tiers on a 429.
 *   --dur=N         seconds 4|6|8 (default 8)
 *   --res=R         720p|1080p|4k (default 1080p; downgraded if the tier lacks it)
 *   --parallel=N    for --motion/--episodes/--trailer: clips in flight at once.
 *                   For --nodes: episode sequences in flight at once (shots
 *                   within one episode still chain in order). Default 1.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { keccak256, toBytes } from 'viem';
import { firebaseStorageService } from '../apps/server/src/services/firebase-storage';
import { dispatchGoogleVeo } from '../apps/server/src/services/video-models/google-veo-dispatch';
import { VIDEO_MODELS } from '../apps/server/src/services/video-models/registry';
import { STYLE, VISUAL, EPISODE_VISUAL } from './lib/op-visual';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const a = args.find((x) => x.startsWith(`${f}=`));
  return a ? a.slice(f.length + 1) : undefined;
};

if (has('--live')) delete process.env.FIRESTORE_EMULATOR_HOST;

// Lowercase, not checksummed — the entities router stores universeAddress
// exactly as-written by the seed script's tRPC call, and Firestore's own
// normalization there ends up lowercase (confirmed against the live
// "Mara Vance" doc). offChainNodes/episodes don't care about case, so this
// same constant is reused for all four collections below.
const UNIVERSE_ID = '0x6c3ae0be32a7200f73ba59f1fe95ed9e06d15abe';
const CREATOR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const DRY_RUN = has('--dry-run');
const FORCE = has('--force');
const ONLY = val('--only')?.toLowerCase();
const KIND = val('--kind')?.toLowerCase();
const LIMIT = val('--limit') ? Number(val('--limit')) : Infinity;
// Stop the process after this many successful clips this run — lets an hourly
// cron drain the Veo quota window without spinning on 429s for the rest of the hour.
const MAX = val('--max') ? Number(val('--max')) : Infinity;
// How many clips to generate concurrently within a phase (default 1 = old
// sequential behaviour). --nodes stays sequential regardless — its chain
// (previousNodeId) is only known once the prior node exists.
const CONCURRENCY = val('--parallel') ? Math.max(1, Number(val('--parallel'))) : 1;
let made = 0;
let maxHit = false;
function recordSuccess() {
  made++;
  if (made >= MAX && !maxHit) {
    maxHit = true;
    console.log(
      `\n  hit --max=${MAX} — finishing in-flight clips, then stopping (resume next time)`
    );
  }
}
// Registry id (see apps/server/src/services/video-models/registry.ts). The fast
// tier has real quota headroom on this key; dispatchGoogleVeo auto-falls-back
// down the Google Veo tiers on a 429.
const MODEL = val('--model') ?? 'veo-31-fast-preview-google';
const PRIMARY = VIDEO_MODELS.find((m) => m.id === MODEL && m.provider === 'google');
if (!PRIMARY) {
  console.error(
    `--model="${MODEL}" is not a Google Veo registry id. Options: ` +
      VIDEO_MODELS.filter((m) => m.provider === 'google' && m.id.includes('veo'))
        .map((m) => m.id)
        .join(', ')
  );
  process.exit(1);
}
const DUR = val('--dur') ? Number(val('--dur')) : 8;
const RES = (val('--res') ?? '1080p') as '720p' | '1080p' | '4k';
// Veo on the AI Studio surface must inline the source image; safeFetch of a
// firebasestorage URL can fail from this environment, so --motion is
// text-to-video by default. Pass --i2v to condition on each entity's cover.
const I2V = has('--i2v');
const GOOGLE_API_KEY = process.env.GEN_GOOGLE_KEY?.trim() || process.env.GOOGLE_API_KEY; // GEN_GOOGLE_KEY = drop-in second AI Studio key for fresh Veo quota

let phases = {
  motion: has('--motion'),
  episodes: has('--episodes'),
  trailer: has('--trailer'),
  nodes: has('--nodes'),
};
if (!phases.motion && !phases.episodes && !phases.trailer && !phases.nodes) phases.motion = true;

const MOTION_CLAUSE =
  'Subtle live-action cinematography: a slow push-in or gentle handheld drift, practical light flicker, ' +
  'atmospheric haze or dust in the light, a small human motion (a breath, a blink, a hand), distant background life. ' +
  'Locked colour, 35mm grain, no camera whip, no morphing, no text. One continuous shot.';

// ── Trailer shot list (text-to-video) ───────────────────────────────────────
const TRAILER: string[] = [
  'A storefront window at night, hand-painted with a crooked QR code; inside, candlelight and a loose circle of ordinary people.',
  "A laptop on a bare altar table resolves a signature; nobody's hands are anywhere near the keyboard.",
  'Close on a hand-lettered ledger — three different inks cross-checking the same entry, a laptop hash matching beside it.',
  "A disgraced journalist stands frozen in a doorway, half-lit by streetlight, watching a vigil she wasn't invited to.",
  'A whiteboard verification flowchart in a repurposed check-cashing storefront; a calm man teaches a room to read a block explorer.',
  'A glass high-rise boardroom at dusk — a dozen executives around a table lit by a slide with a redacted codename.',
  'A windowless government briefing room, fluorescent tubes, a wall of printed transaction graphs, a precise woman standing before it.',
  'A cathedral nave, half-empty, afternoon light through stained glass; an old bishop holds an unlit candle, alone.',
  'A dust-covered desk in an abandoned apartment — a calendar frozen two years back, one new footprint leading to the keyboard.',
  'A cold tower lobby at night, turnstiles under sterile light, the skyline doubled in glass.',
  'A packed converted storefront church, a QR code glowing on the back wall like an icon, the room leaning toward one laptop.',
  'A small huddle of early congregants around a single glowing screen, the exact moment a new signature resolves as verified.',
  'A reporter\'s hand hovers over a laptop trackpad, cursor over "Publish," a half-written headline behind it that says nothing certain.',
  'A terminal window scrolls forward, timestamped signed entries stacking one after another, reflected in a pair of reading glasses.',
  'A midnight meeting between two people who should not be in the same room, a folder passed under a table.',
  'The storefront door, seen from outside in the rain; a hand-painted symbol glows faint orange behind the glass. Cut to black.',
];

// ── Per-episode shot lists (text-to-video) ──────────────────────────────────
const EPISODE_SHOTS: Record<string, string[]> = {
  'Ep 1 — The Vigil': [
    'A disgraced journalist chases a lead on a missing cryptographer into what she assumes is a tech-bro cult meeting.',
    "Instead she finds a candlelit storefront circle of exhausted, ordinary people cross-checking a claim about a landlord's falsified inspection records.",
    "A cardigan-wearing administrator teaches a nervous newcomer to read a block explorer before he's taught any doctrine.",
    'She leaves before sunrise, more disturbed by how ordinary it all was than she would have been by any theatrics.',
  ],
  'Ep 2 — The Signing Wallet': [
    "A single laptop glows on a bare altar table; a freshly verified signature resolves, timestamped, nobody's hands anywhere near the keys.",
    "The administrator explains, plainly, that the movement's founder has been dead two years and no one has ever had the private key.",
    'The journalist digs through a public records archive at 2 a.m., a single obituary pulled up beside a wallet explorer.',
    'A flashback: a small huddle of early congregants crowd one glowing laptop in a bare unfinished room, faces lit only by the screen.',
  ],
  'Ep 3 — The Verification Rite': [
    'A hand-lettered ledger open on a wooden table, three different handwriting styles cross-checking the same entry in colored ink.',
    'A claim gets pinned to a corkboard, unresolved, neither condemned nor accepted — set aside, patient, for as long as it takes.',
    'The journalist quietly plants a false claim to test the rite, sliding a folded note into the stack.',
    'Days later the congregation calmly, methodically unwinds her test in front of her — no anger, only proof.',
  ],
  'Ep 4 — Meridian Tower': [
    'A cold glass-and-steel tower lobby at night, turnstiles under sterile light, elevators reflected and doubled in glass.',
    'A dozen executives in a dusk boardroom around a single screen showing a slide titled with a redacted codename.',
    'A leaked opposition-research dossier on the journalist spreads across a conference table, tabs color-coded by weakness.',
    "A junior analyst says the quiet part out loud: unfalsifiable verification is a threat to every business built on being the only one who can tell you what's true.",
  ],
  'Ep 5 — The Undersecretary': [
    'A windowless government briefing room, fluorescent tubes humming, a wall of printed transaction graphs behind a precise investigator.',
    'She interviews the journalist across a plain table, warning her she is being used as a vector by both sides at once.',
    'Her own interagency task force quietly orders her to manufacture a violation where the ledger shows none.',
    "A late-night meeting between the investigator and the movement's administrator, in a car, that neither of them can explain to their own side.",
  ],
  'Ep 6 — The Bishop': [
    'An old cathedral official sits alone in a half-empty nave, afternoon light through stained glass, a single unlit candle in his hand.',
    'He meets quietly with Consortium representatives, agreeing — without quite admitting it — to lend a smear campaign moral cover.',
    "Alone that night, he reads the movement's doctrine by lamp light, visibly unsettled by how well it holds together.",
    'From the pulpit he preaches against "belief without evidence" — and the words land wrong, turned back on his own institution.',
  ],
  'Ep 7 — The Long Silence': [
    'A dust-covered desk in an abandoned apartment, a monitor left on standby for years, a wall calendar frozen two years in the past.',
    'One new footprint in the dust leads straight to the keyboard.',
    "The journalist finds a buried filing that ties the movement's tripled membership to a single date no one will discuss.",
    "A quiet realization crosses her face: the wallet's key was never lost. It was only ever silent.",
  ],
  'Ep 8 — The Founding Signature': [
    'A flashback completes: the small huddle of early congregants, the first doctrine resolving three days after a funeral no one attended.',
    'The journalist\'s cursor hovers over "Publish" on a story she is no longer sure who it serves.',
    'The storefront church stands packed to the doors, a hand-painted QR code glowing on the back wall like an icon.',
    'A terminal window scrolls forward; a new signature resolves, timestamped, unexplained. Cut to black.',
  ],
};

// ── helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Each item keeps
 * its own index (for sortOrder etc.) regardless of finish order. Stops handing
 * out new work once --max is hit, but lets already-started clips finish rather
 * than aborting them mid-write.
 */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  async function worker() {
    for (;;) {
      if (maxHit) return;
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
}

const TRANSIENT =
  /503|internal server|no videoUrl|UNAVAILABLE|deadline|ECONNRESET|fetch failed|temporar/i;

async function veoClip(prompt: string, imageUrl?: string): Promise<string> {
  let lastErr = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await dispatchGoogleVeo(
      PRIMARY!,
      {
        prompt,
        imageUrl,
        durationSec: DUR,
        resolution: RES,
        aspectRatio: '16:9',
        mode: imageUrl ? 'image_to_video' : 'text_to_video',
      },
      GOOGLE_API_KEY as string
    );
    if (r.status === 'completed' && r.videoUrl) return r.videoUrl;
    lastErr = r.error || `veo ${r.status}, no videoUrl`;
    if (attempt < 4 && TRANSIENT.test(lastErr)) {
      await sleep(20_000 * attempt);
      continue;
    }
    break;
  }
  throw new Error(lastErr);
}

async function rehost(veoUrl: string, filename: string): Promise<string> {
  const sep = veoUrl.includes('?') ? '&' : '?';
  const res = await fetch(`${veoUrl}${sep}alt=media&key=${GOOGLE_API_KEY}`, {
    headers: { 'x-goog-api-key': GOOGLE_API_KEY as string },
  });
  if (!res.ok) throw new Error(`download ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const key = await firebaseStorageService.upload(buf, filename);
  return firebaseStorageService.getPublicUrl(key);
}

let db: FirebaseFirestore.Firestore;

/** True if a clip for this target + subCategory + sortOrder already exists (skip on re-run unless --force). */
async function mediaExists(
  targetId: string,
  subCategory: string,
  sortOrder: number
): Promise<boolean> {
  if (FORCE) return false;
  const q = await db
    .collection('mediaAttachments')
    .where('targetId', '==', targetId)
    .where('subCategory', '==', subCategory)
    .where('sortOrder', '==', sortOrder)
    .limit(1)
    .get();
  return !q.empty;
}

async function attach(opts: {
  url: string;
  targetType: 'entity' | 'universe';
  targetId: string;
  targetName: string;
  label: string;
  subCategory: string;
  sortOrder: number;
}) {
  const id = randomUUID();
  await db
    .collection('mediaAttachments')
    .doc(id)
    .set({
      contentHash: id,
      originalFilename: `${opts.subCategory}-${opts.sortOrder}.mp4`,
      mimeType: 'video/mp4',
      size: 0,
      url: opts.url,
      targetType: opts.targetType,
      targetId: opts.targetId,
      targetName: opts.targetName,
      category: 'video',
      label: opts.label,
      subCategory: opts.subCategory,
      version: 1,
      variantOf: null,
      variantLabel: MODEL,
      sortOrder: opts.sortOrder,
      generationId: null,
      creator: CREATOR,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
}

function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

// ── off-chain timeline nodes (mirrors offChainNodes.routes.ts) ──────────────
const NODE_CREATOR = CREATOR.toLowerCase();

async function nextNodeId(): Promise<number> {
  const ref = db.collection('offChainNodeCounters').doc(UNIVERSE_ID);
  return db.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    const next = ((d.exists ? (d.data()?.latest as number) : 0) || 0) + 1;
    tx.set(ref, { latest: next, updatedAt: new Date() }, { merge: true });
    return next;
  });
}

/** Existing node for this title, if any (resume-safe). Returns its nodeId. */
async function findNodeByTitle(title: string): Promise<number | null> {
  const q = await db
    .collection('offChainNodes')
    .where('universeId', '==', UNIVERSE_ID)
    .where('title', '==', title)
    .limit(1)
    .get();
  return q.empty ? null : ((q.docs[0].data().nodeId as number) ?? null);
}

async function createNode(opts: {
  videoUrl: string;
  plot: string;
  title: string;
  previousNodeId: number;
  sceneId: number;
}): Promise<number> {
  const nodeId = await nextNodeId();
  const id = randomUUID();
  await db
    .collection('offChainNodes')
    .doc(id)
    .set({
      id,
      universeId: UNIVERSE_ID,
      nodeId,
      creator: NODE_CREATOR,
      contentHash: keccak256(toBytes(opts.videoUrl)),
      plotHash: keccak256(toBytes(opts.plot)),
      videoUrl: opts.videoUrl,
      plot: opts.plot,
      title: opts.title,
      sceneId: opts.sceneId,
      previousNodeId: opts.previousNodeId,
      children: [],
      canon: opts.previousNodeId === 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  if (opts.previousNodeId > 0) {
    const p = await db
      .collection('offChainNodes')
      .where('universeId', '==', UNIVERSE_ID)
      .where('nodeId', '==', opts.previousNodeId)
      .limit(1)
      .get();
    if (!p.empty) {
      const kids = (p.docs[0].data().children || []) as number[];
      if (!kids.includes(nodeId))
        await p.docs[0].ref.update({ children: [...kids, nodeId], updatedAt: new Date() });
    }
  }
  return nodeId;
}

/** URL of an already-generated clip for this ep/shot, if one exists. */
async function existingClipUrl(
  targetId: string,
  subCategory: string,
  sortOrder: number
): Promise<string | null> {
  const q = await db
    .collection('mediaAttachments')
    .where('targetId', '==', targetId)
    .where('subCategory', '==', subCategory)
    .where('sortOrder', '==', sortOrder)
    .limit(1)
    .get();
  return q.empty ? null : ((q.docs[0].data().url as string) ?? null);
}

/**
 * Find the "Ep N — Title" wiki entity for an episode, creating it (kind:
 * 'event', matching the populate-*-wiki.ts convention) if the wiki was never
 * pre-seeded with it. No cover image — this is a timeline marker, not a
 * browsable character; the wiki team can generate art for it later.
 */
async function findOrCreateEpisodeEntity(
  entities: any[],
  epName: string
): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  id: string;
  name: string;
  description?: string;
}> {
  const found = entities.find((e) => e.name === epName);
  if (found) return found;
  const shots = EPISODE_SHOTS[epName] ?? [];
  const description = shots.join(' ').slice(0, 500);
  const ref = db.collection('entities').doc();
  const doc = {
    id: ref.id,
    name: epName,
    kind: 'event',
    description,
    universeAddress: UNIVERSE_ID,
    monetized: false,
    creator: NODE_CREATOR,
    createdBy: NODE_CREATOR,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await ref.set(doc);
  const created = { ref, ...doc };
  entities.push(created);
  console.log(`  + created wiki entity "${epName}" (${ref.id})`);
  return created;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!GOOGLE_API_KEY)
    throw new Error('GOOGLE_API_KEY not in env — run through `railway run --service loar --`');

  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  initializeApp({ credential: cert(sa) });
  db = getFirestore();
  db.settings({ preferRest: true });

  console.log('\n' + '='.repeat(66));
  console.log('  Orange Pills — video (Google Veo direct → Firebase Storage)');
  console.log('='.repeat(66));
  console.log(`  Model   : ${MODEL}   ${DUR}s   ${RES}`);
  console.log(
    `  Phases  : ${Object.entries(phases)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ')}`
  );
  console.log(`  Dry run : ${DRY_RUN}${FORCE ? '   force: true' : ''}`);
  console.log('');

  const entSnap = await db.collection('entities').where('universeAddress', '==', UNIVERSE_ID).get();
  const entities = entSnap.docs.map((d) => ({ ref: d.ref, ...(d.data() as any) }));

  // ── motion: i2v/t2v per entity cover ──────────────────────────────────────
  if (phases.motion) {
    let targets = entities.filter((e) => FORCE || !e.metadata?.videoUrl);
    if (ONLY) targets = targets.filter((e) => String(e.name).toLowerCase().includes(ONLY));
    if (KIND) targets = targets.filter((e) => String(e.kind).toLowerCase() === KIND);
    targets.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (LIMIT !== Infinity) targets = targets.slice(0, LIMIT);
    console.log(`  motion: ${targets.length} entity clips (${CONCURRENCY} at a time)\n`);
    let ok = 0;
    await mapLimit(targets, CONCURRENCY, async (e) => {
      const base =
        EPISODE_VISUAL[e.name] ??
        VISUAL[e.name] ??
        `${e.name}. ${(e.description ?? '').slice(0, 220)}`;
      const prompt = `${base} ${MOTION_CLAUSE} ${STYLE}`;
      console.log(`  • ${e.name}`);
      if (DRY_RUN) {
        console.log(`      ${I2V ? 'i2v' : 't2v'} :: ${prompt.slice(0, 90)}…`);
        return;
      }
      if (await mediaExists(e.id, 'op-motion', 0)) {
        console.log(`      · ${e.name} exists — skip`);
        return;
      }
      try {
        const veoUrl = await veoClip(prompt, I2V ? e.imageUrl : undefined);
        const url = await rehost(veoUrl, `op-motion-${slug(e.name)}.mp4`);
        await attach({
          url,
          targetType: 'entity',
          targetId: e.id,
          targetName: e.name,
          label: `${e.name} — motion`,
          subCategory: 'op-motion',
          sortOrder: 0,
        });
        await e.ref.update({ 'metadata.videoUrl': url, updatedAt: new Date() });
        console.log(`      ✓ ${e.name} ${url}`);
        ok++;
        recordSuccess();
      } catch (err: any) {
        console.log(`      ✗ ${e.name} ${err?.message?.slice(0, 200) ?? err}`);
      }
      if (CONCURRENCY <= 1) await sleep(4000);
    });
    console.log(`\n  motion done — ${ok}/${targets.length}\n`);
  }

  // ── episodes: multi-shot animatic per episode entity ──────────────────────
  if (phases.episodes) {
    let names = Object.keys(EPISODE_SHOTS);
    if (ONLY) names = names.filter((n) => n.toLowerCase().includes(ONLY));
    if (LIMIT !== Infinity) names = names.slice(0, LIMIT);
    for (const name of names) {
      const ent = DRY_RUN
        ? entities.find((e) => e.name === name)
        : await findOrCreateEpisodeEntity(entities, name);
      if (!ent) {
        console.log(`  ! no entity "${name}" — skipping (dry run never creates one)`);
        continue;
      }
      console.log(`  ${name}: ${EPISODE_SHOTS[name].length} shots (${CONCURRENCY} at a time)`);
      await mapLimit(EPISODE_SHOTS[name], CONCURRENCY, async (shot, idx) => {
        const i = idx + 1;
        if (DRY_RUN) {
          console.log(`      ${i}. ${shot.slice(0, 100)}…`);
          return;
        }
        if (await mediaExists(ent.id, 'op-animatic', i)) {
          console.log(`      · ${i} exists — skip`);
          return;
        }
        try {
          const veoUrl = await veoClip(`${shot} ${STYLE}`);
          const url = await rehost(veoUrl, `op-${slug(name)}-shot${i}.mp4`);
          await attach({
            url,
            targetType: 'entity',
            targetId: ent.id,
            targetName: name,
            label: `${name} — shot ${i}`,
            subCategory: 'op-animatic',
            sortOrder: i,
          });
          console.log(`      ✓ ${i} ${url}`);
          recordSuccess();
        } catch (err: any) {
          console.log(`      ✗ ${i} ${err?.message?.slice(0, 180) ?? err}`);
        }
        if (CONCURRENCY <= 1) await sleep(4000);
      });
    }
    console.log('');
  }

  // ── trailer: attached to the universe ────────────────────────────────────
  if (phases.trailer) {
    const shots = LIMIT !== Infinity ? TRAILER.slice(0, LIMIT) : TRAILER;
    console.log(`  trailer: ${shots.length} shots (${CONCURRENCY} at a time)`);
    await mapLimit(shots, CONCURRENCY, async (shot, idx) => {
      const i = idx + 1;
      if (DRY_RUN) {
        console.log(`      ${i}. ${shot.slice(0, 100)}…`);
        return;
      }
      if (await mediaExists(UNIVERSE_ID, 'op-trailer', i)) {
        console.log(`      · ${i} exists — skip`);
        return;
      }
      try {
        const veoUrl = await veoClip(`${shot} ${STYLE}`);
        const url = await rehost(veoUrl, `op-trailer-shot${String(i).padStart(2, '0')}.mp4`);
        await attach({
          url,
          targetType: 'universe',
          targetId: UNIVERSE_ID,
          targetName: 'Orange Pills',
          label: `Trailer — shot ${i}`,
          subCategory: 'op-trailer',
          sortOrder: i,
        });
        console.log(`      ✓ ${i} ${url}`);
        recordSuccess();
      } catch (err: any) {
        console.log(`      ✗ ${i} ${err?.message?.slice(0, 180) ?? err}`);
      }
      if (CONCURRENCY <= 1) await sleep(4000);
    });
    console.log('');
  }

  // ── nodes: one independent node sequence per episode, episodes run in parallel ─
  // Each episode is its own chain (root previousNodeId 0, shots link within that
  // episode only) — episodes don't depend on each other, so up to CONCURRENCY of
  // them build at once. Within one episode, shots still create in order (each
  // needs the previous shot's nodeId), but the slow part — Veo generation — for
  // *different* episodes overlaps.
  if (phases.nodes) {
    const episodeNames = Object.keys(EPISODE_SHOTS);
    console.log(
      `  nodes: ${episodeNames.length} independent episode sequences (${CONCURRENCY} at a time)\n`
    );

    await mapLimit(episodeNames, CONCURRENCY, async (epName, epIdx) => {
      const ent = DRY_RUN
        ? entities.find((e) => e.name === epName)
        : await findOrCreateEpisodeEntity(entities, epName);
      if (!ent) {
        console.log(`  ! no entity "${epName}" — skipping (dry run never creates one)`);
        return;
      }
      const shots = EPISODE_SHOTS[epName];
      console.log(`  ${epName}: ${shots.length} shots`);
      const clips: Array<{ nodeId: number; title: string; videoUrl: string }> = [];
      let prev = 0; // root of THIS episode's own chain — independent of every other episode

      for (let idx = 0; idx < shots.length; idx++) {
        if (maxHit) break;
        const i = idx + 1;
        const shot = shots[idx];
        const title = `${epName} — shot ${i}`;

        const existingNode = await findNodeByTitle(title);
        if (existingNode != null) {
          console.log(`      · ${epName} ${i} node #${existingNode} exists`);
          const nd = await db
            .collection('offChainNodes')
            .where('universeId', '==', UNIVERSE_ID)
            .where('nodeId', '==', existingNode)
            .limit(1)
            .get();
          const v = nd.empty ? '' : (nd.docs[0].data().videoUrl as string);
          clips.push({ nodeId: existingNode, title, videoUrl: v });
          prev = existingNode;
          continue;
        }

        if (DRY_RUN) {
          console.log(`      ${epName} ${i} would node: ${shot.slice(0, 80)}…`);
          continue;
        }

        // Reuse an already-generated animatic clip for this ep/shot if we have one.
        let url = await existingClipUrl(ent.id, 'op-animatic', i);
        if (url) {
          console.log(`      ${epName} ${i} reuse clip`);
        } else {
          try {
            const veoUrl = await veoClip(`${shot} ${STYLE}`);
            url = await rehost(veoUrl, `op-node-${slug(epName)}-shot${i}.mp4`);
            await attach({
              url,
              targetType: 'entity',
              targetId: ent.id,
              targetName: epName,
              label: `${epName} — shot ${i}`,
              subCategory: 'op-animatic',
              sortOrder: i,
            });
            console.log(`      ${epName} ${i} ✓ new clip`);
            recordSuccess();
          } catch (err: any) {
            console.log(`      ${epName} ${i} ✗ ${err?.message?.slice(0, 160) ?? err}`);
            continue; // leave a gap; a later run fills it and chains in place
          }
          if (CONCURRENCY <= 1) await sleep(4000);
        }

        const nodeId = await createNode({
          videoUrl: url,
          plot: shot,
          title,
          previousNodeId: prev,
          sceneId: i,
        });
        console.log(`      ${epName} ${i} → node #${nodeId}`);
        clips.push({ nodeId, title, videoUrl: url });
        prev = nodeId;
      }

      if (!DRY_RUN && clips.length > 0) {
        const q = await db
          .collection('episodes')
          .where('universeId', '==', UNIVERSE_ID)
          .where('title', '==', epName)
          .limit(1)
          .get();
        const epId = q.empty ? randomUUID() : q.docs[0].id;
        await db
          .collection('episodes')
          .doc(epId)
          .set(
            {
              id: epId,
              universeId: UNIVERSE_ID,
              episodeNumber: epIdx + 1,
              title: epName,
              description: String(ent.description ?? '').slice(0, 240),
              isCanon: true,
              clipCount: clips.length,
              clips: clips.map((c, idx) => ({
                nodeId: String(c.nodeId),
                label: `Shot ${idx + 1}`,
                videoUrl: c.videoUrl,
              })),
              sourceCreator: NODE_CREATOR,
              updatedAt: new Date(),
              createdAt: new Date(),
            },
            { merge: true }
          );
        console.log(`  episode "${epName}" — ${clips.length} clips → ${epId}`);
      }
    });
    console.log('');
  }

  console.log('='.repeat(66));
  console.log(`  Done — /universe/${UNIVERSE_ID}`);
  console.log('='.repeat(66) + '\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFAILED:', err?.message ?? err);
  process.exit(1);
});

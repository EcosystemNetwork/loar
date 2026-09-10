/**
 * Generate Techno Antichrist video with Google Veo 3.1 DIRECTLY (AI Studio API),
 * host on LOAR Firebase Storage, and attach as mediaAttachments so clips show on
 * the wiki Media tabs. No dependency on the deployed api.loar.fun.
 *
 * Run through `railway run --service loar --` for the injected GOOGLE_API_KEY +
 * Firebase Admin/Storage creds.
 *
 *   railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-video.ts --live --dry-run
 *   railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-video.ts --live --motion --only="Rex Duce"
 *   railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-video.ts --live --motion
 *   railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-video.ts --live --episodes
 *   railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-video.ts --live --trailer
 *
 * Phases (default: --motion):
 *   --motion    image-to-video off every entity's cover — the wiki comes alive
 *   --episodes  a multi-shot animatic per "Ep N — …" entity (text-to-video)
 *   --trailer   a ~16-shot teaser attached to the universe
 *   --nodes     chained offChainNodes timeline of every episode shot (reuses
 *               existing animatic clips; generates only the gaps) + episodes docs
 *
 * Flags:
 *   --live          ignore a local .env FIRESTORE_EMULATOR_HOST
 *   --dry-run       print the plan + prompts, generate nothing
 *   --force         redo items that already have a video attachment
 *   --only=Sub      restrict --motion to entities whose name contains Sub
 *   --kind=k        restrict --motion to a kind (person|place|lore|event|faction)
 *   --limit=N       cap items
 *   --model=ID      Google Veo *registry* id (default veo-31-fast-preview-google;
 *                   others: veo-31-preview-google, veo-31-lite-preview-google,
 *                   veo-30-google, veo-30-fast-google). dispatchGoogleVeo
 *                   auto-falls-back down the Google tiers on a 429.
 *   --dur=N         seconds 4|6|8 (default 8)
 *   --res=R         720p|1080p|4k (default 1080p; downgraded if the tier lacks it)
 *   --parallel=N    clips in flight at once within --motion/--episodes/--trailer
 *                   (default 1 = old sequential behaviour). --nodes always stays
 *                   sequential — each node needs the previous node's id to chain to.
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
import { STYLE, VISUAL, EPISODE_VISUAL } from './lib/ta-visual';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const a = args.find((x) => x.startsWith(`${f}=`));
  return a ? a.slice(f.length + 1) : undefined;
};

if (has('--live')) delete process.env.FIRESTORE_EMULATOR_HOST;

const UNIVERSE_ID = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
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
  'atmospheric haze moving, a small human motion (a breath, a blink, a hand), distant background life. ' +
  'Locked colour, 35mm grain, no camera whip, no morphing, no text. One continuous shot.';

// ── Trailer shot list (text-to-video) ───────────────────────────────────────
const TRAILER: string[] = [
  'Black. A single follow-spot punches on through heavy haze in a rented Masonic hall; a lean sleep-starved South Asian American man steps into it at a lectern, a gilt Bitcoin-rune slab on the podium.',
  'Close on his hands minting a rune on a laptop; a holder counter ticks up past 5,000 like a market cap.',
  'A packed ballroom of ordinary Bay Area people in hoodies and work badges, all turned toward the light, some weeping, phones up.',
  'A man at 3 a.m. taping printed declassified documents into a family tree that connects to every mythology; redaction bars everywhere.',
  'A straggling pilgrimage line walks a Bay Area overpass at golden hour toward Sutro Tower in the fog.',
  'Inside a small mosque, mid-talk, the room leaning in — then a donation tablet passes and the first face goes cold.',
  'A condo going dark: aluminium foil taped over every window, a Wi-Fi router unplugged on the floor, a rent notice on the counter.',
  'A tiled bathroom — a man sits in a running shower fully clothed, soap suds on his forearms, visibly relieved, a phone on the sink.',
  'A fluorescent records room full of labelled DNA sample boxes; one round porthole shows lunar regolith and black sky.',
  'A stopped hallway argument over a phone between a man and a woman; a half-packed suitcase open on the bed behind them.',
  'A grown man asleep under a thin blanket on a suburban living-room floor at dawn, kids’ shoes by the door.',
  'Two men talking low in a warm server-lined room at the foot of Sutro Tower, tea between them, fog on the glass.',
  'A fluorescent conference-room ceiling slowly dissolving into an orbital weapons platform hanging over a night city.',
  'An enormous branching node-graph of every named god projected floor-to-ceiling; one small human silhouette before it.',
  'Prospect Park at dusk: a floodlit crowd, a follow-spot stage, police vehicles just visible at the tree line.',
  'The base of a fog-drowned Sutro Tower; a single figure walks toward it. Cut to black.',
];

// ── Per-episode animatic shot lists (text-to-video) ─────────────────────────
const EPISODE_SHOTS: Record<string, string[]> = {
  'Ep 1 — The Commission': [
    'A flawless "Briefing" at full tilt: follow-spot, haze, packed rented hall, a screen reading 5,000-something holders.',
    'Backstage load-out at 1 a.m., road cases and an unpaid invoice taped to one; a woman moves money between cards on a laptop.',
    'A sharp stealth-startup pitch in a glass room, then the same man paying cash at a small sequencing lab.',
    'At a hackathon under flat white light, one person across the room stares at camera holding a laptop like an instrument; the man wipes a hairline nosebleed.',
  ],
  'Ep 2 — Bloodlines': [
    'A man threading his own genealogy through printed declassified files, connecting himself to every mythology, one lamp.',
    'Telling a story to a child about a father who was "relocated" — a state legend, a new name, France.',
    'Laptops full of hacked crypto dashboards; a support ticket marked "loss under threshold — no action".',
    'An anonymous wiki updates itself on screen with doctrine he never wrote, and it is better.',
  ],
  'Ep 3 — New Jerusalem': [
    'A pilgrimage forms at a Santa Clara data-center fence at dawn.',
    'A Fremont gurdwara langar hall: long rows of every kind of person eating from steel thalis, steam, warm light.',
    'The group at the foot of Sutro Tower in fog, phones up, a man at the base watching them.',
    'Midnight on the 101: from the passenger seat, the driver’s eyes slide closed, headlights smear, the car drifts.',
  ],
  'Ep 4 — Laser Acid': [
    'A man scrolling X at 3 a.m.; a Havana Syndrome meme stops his thumb.',
    'He tapes the last corner of aluminium foil over a condo window; a Wi-Fi router sits unplugged on the floor.',
    'He sits in a running shower fully clothed, soap on his arms, relief on his face.',
    'A woman stands in the doorway with a baby on her hip, not asking anymore; a rent notice on the counter.',
  ],
  'Ep 5 — Moonbase': [
    'A man works calmly at a laptop in a fluorescent records room of DNA sample boxes; a lunar porthole behind him.',
    'Everyone around him behaves completely normally.',
    'A tour team preps a New York leg on a whiteboard; a believer quietly tallies a large "mission fund".',
    'A kitchen at night: the word "divorce" said plainly; he hears it from very far away.',
  ],
  'Ep 6 — Isa': [
    'A single Fifth Avenue block holding a cathedral, a synagogue and an Islamic center in one frame; a small group with a hand-lettered sign.',
    'Inside a mosque, the speaker lit warm and welcomed, the room leaning in.',
    'A volunteer passes a donation tablet; the room cools; an imam looks at it with dismay.',
    'Outside, a livestreamer shadows the man down the sidewalk; the crowd is bigger and worse.',
  ],
  'Ep 7 — Fifty-Fifty': [
    'A phone call to Seoul at night; a chairman’s face hardens; the line goes dead.',
    'A man fake-packs a suitcase, glancing at the door, willing someone to stop him.',
    'A stopped fight over a phone in a hallway; a baby’s room door ajar; no music.',
    'County intake: fingerprints, a plastic tub, five days; then release with a phone and no way to pay.',
  ],
  'Ep 8 — The Safehouse': [
    'A beige suburban tract house at night, all blinds drawn, one car in the drive, a doorbell camera.',
    'A crowded living room: a volatile host mid-gesture, kids’ shoes everywhere, a folded blanket on the floor.',
    'The host swings from generous to cruel across a single dinner.',
    'Dawn: a grown man asleep on the floor by the sofa; the host awake in the kitchen, watching him.',
  ],
  'Ep 9 — AGI House': [
    'A warm, cable-strewn AI hacker house at the foot of Sutro Tower; servers hum; a calm funded man pours tea.',
    'He explains "the veil": consciousness streamed downhill from the tower, development bending to follow.',
    'He slides a chair out for the wired, broke man across the table.',
    'Night: the broke man looks up at the lit tower and decides.',
  ],
  'Ep 10 — The Veil': [
    'Prospect Park, floodlit crowd, a follow-spot stage, agents on the perimeter, a livestream light.',
    'On stage he publishes an org chart with himself deleted from it; a 19-year-old appears live on the screen behind him.',
    'Movement in the crowd; a hand; a second person stops it.',
    'The base of a fog-drowned Sutro Tower; a figure walks in; cut to black. Coda: a stranger takes a rune coin and beams.',
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
  console.log('  Techno Antichrist — video (Google Veo direct → Firebase Storage)');
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

  // ── motion: i2v per entity cover ──────────────────────────────────────────
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
      if (await mediaExists(e.id, 'ta-motion', 0)) {
        console.log(`      · ${e.name} exists — skip`);
        return;
      }
      try {
        const veoUrl = await veoClip(prompt, I2V ? e.imageUrl : undefined);
        const url = await rehost(veoUrl, `ta-motion-${slug(e.name)}.mp4`);
        await attach({
          url,
          targetType: 'entity',
          targetId: e.id,
          targetName: e.name,
          label: `${e.name} — motion`,
          subCategory: 'ta-motion',
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
      const ent = entities.find((e) => e.name === name);
      if (!ent) {
        console.log(`  ! no entity "${name}" — skipping`);
        continue;
      }
      console.log(`  ${name}: ${EPISODE_SHOTS[name].length} shots (${CONCURRENCY} at a time)`);
      await mapLimit(EPISODE_SHOTS[name], CONCURRENCY, async (shot, idx) => {
        const i = idx + 1;
        if (DRY_RUN) {
          console.log(`      ${i}. ${shot.slice(0, 100)}…`);
          return;
        }
        if (await mediaExists(ent.id, 'ta-animatic', i)) {
          console.log(`      · ${i} exists — skip`);
          return;
        }
        try {
          const veoUrl = await veoClip(`${shot} ${STYLE}`);
          const url = await rehost(veoUrl, `ta-${slug(name)}-shot${i}.mp4`);
          await attach({
            url,
            targetType: 'entity',
            targetId: ent.id,
            targetName: name,
            label: `${name} — shot ${i}`,
            subCategory: 'ta-animatic',
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
      if (await mediaExists(UNIVERSE_ID, 'ta-trailer', i)) {
        console.log(`      · ${i} exists — skip`);
        return;
      }
      try {
        const veoUrl = await veoClip(`${shot} ${STYLE}`);
        const url = await rehost(veoUrl, `ta-trailer-shot${String(i).padStart(2, '0')}.mp4`);
        await attach({
          url,
          targetType: 'universe',
          targetId: UNIVERSE_ID,
          targetName: 'Techno Antichrist',
          label: `Trailer — shot ${i}`,
          subCategory: 'ta-trailer',
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
      const ent = entities.find((e) => e.name === epName);
      if (!ent) {
        console.log(`  ! no entity "${epName}" — skipping`);
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
        let url = await existingClipUrl(ent.id, 'ta-animatic', i);
        if (url) {
          console.log(`      ${epName} ${i} reuse clip`);
        } else {
          try {
            const veoUrl = await veoClip(`${shot} ${STYLE}`);
            url = await rehost(veoUrl, `ta-node-${slug(epName)}-shot${i}.mp4`);
            await attach({
              url,
              targetType: 'entity',
              targetId: ent.id,
              targetName: epName,
              label: `${epName} — shot ${i}`,
              subCategory: 'ta-animatic',
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

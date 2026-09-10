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
 *
 * Flags:
 *   --live          ignore a local .env FIRESTORE_EMULATOR_HOST
 *   --dry-run       print the plan + prompts, generate nothing
 *   --force         redo items that already have a video attachment
 *   --only=Sub      restrict --motion to entities whose name contains Sub
 *   --kind=k        restrict --motion to a kind (person|place|lore|event|faction)
 *   --limit=N       cap items
 *   --model=ID      google veo model id (default veo-3.1-fast-generate-preview;
 *                   others: veo-3.1-generate-preview, veo-3.1-lite-generate-preview,
 *                   veo-3.0-generate-001)
 *   --dur=N         seconds 4|6|8 (default 8)
 *   --res=R         720p|1080p|4k (default 1080p; 4k only 8s premium)
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseStorageService } from '../apps/server/src/services/firebase-storage';
import { veoGenerate } from '../apps/server/src/services/gemini';
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
const MODEL = val('--model') ?? 'veo-3.1-fast-generate-preview';
const DUR = val('--dur') ? Number(val('--dur')) : 8;
const RES = (val('--res') ?? '1080p') as '720p' | '1080p' | '4k';
// Veo on the AI Studio surface must inline the source image; safeFetch of a
// firebasestorage URL can fail from this environment, so --motion is
// text-to-video by default. Pass --i2v to condition on each entity's cover.
const I2V = has('--i2v');
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

let phases = { motion: has('--motion'), episodes: has('--episodes'), trailer: has('--trailer') };
if (!phases.motion && !phases.episodes && !phases.trailer) phases.motion = true;

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

async function veoClip(prompt: string, imageUrl?: string): Promise<string> {
  const r = await veoGenerate({
    apiKey: GOOGLE_API_KEY,
    model: MODEL,
    prompt,
    imageUrl,
    durationSec: DUR,
    resolution: RES,
    aspectRatio: '16:9',
  });
  if (r.status !== 'completed' || !r.videoUrl) {
    throw new Error(r.error || `veo ${r.status}, no videoUrl`);
  }
  return r.videoUrl;
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
    console.log(`  motion: ${targets.length} entity clips\n`);
    let ok = 0;
    for (const e of targets) {
      const base =
        EPISODE_VISUAL[e.name] ??
        VISUAL[e.name] ??
        `${e.name}. ${(e.description ?? '').slice(0, 220)}`;
      const prompt = `${base} ${MOTION_CLAUSE} ${STYLE}`;
      console.log(`  • ${e.name}`);
      if (DRY_RUN) {
        console.log(`      ${I2V ? 'i2v' : 't2v'} :: ${prompt.slice(0, 90)}…`);
        continue;
      }
      if (await mediaExists(e.id, 'ta-motion', 0)) {
        console.log(`      · exists — skip`);
        continue;
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
        console.log(`      ✓ ${url}`);
        ok++;
      } catch (err: any) {
        console.log(`      ✗ ${err?.message?.slice(0, 200) ?? err}`);
      }
      await sleep(1500);
    }
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
      console.log(`  ${name}: ${EPISODE_SHOTS[name].length} shots`);
      let i = 0;
      for (const shot of EPISODE_SHOTS[name]) {
        i++;
        if (DRY_RUN) {
          console.log(`      ${i}. ${shot.slice(0, 100)}…`);
          continue;
        }
        if (await mediaExists(ent.id, 'ta-animatic', i)) {
          console.log(`      · ${i} exists — skip`);
          continue;
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
        } catch (err: any) {
          console.log(`      ✗ ${i} ${err?.message?.slice(0, 180) ?? err}`);
        }
        await sleep(1500);
      }
    }
    console.log('');
  }

  // ── trailer: attached to the universe ────────────────────────────────────
  if (phases.trailer) {
    const shots = LIMIT !== Infinity ? TRAILER.slice(0, LIMIT) : TRAILER;
    console.log(`  trailer: ${shots.length} shots`);
    let i = 0;
    for (const shot of shots) {
      i++;
      if (DRY_RUN) {
        console.log(`      ${i}. ${shot.slice(0, 100)}…`);
        continue;
      }
      if (await mediaExists(UNIVERSE_ID, 'ta-trailer', i)) {
        console.log(`      · ${i} exists — skip`);
        continue;
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
      } catch (err: any) {
        console.log(`      ✗ ${i} ${err?.message?.slice(0, 180) ?? err}`);
      }
      await sleep(1500);
    }
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

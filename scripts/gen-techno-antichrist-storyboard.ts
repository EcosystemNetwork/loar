/**
 * Still-image storyboard for every episode shot + trailer beat, using Nano
 * Banana (Google image gen — no per-window quota wall, unlike Veo). Fills in
 * real visual content for shots that don't have a video clip yet; if video
 * shows up later it can coexist (different subCategory).
 *
 * Run via `railway run --service loar --` for the injected creds (or set
 * GEN_GOOGLE_KEY for a working key).
 *
 *   railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-storyboard.ts --live --dry-run
 *   railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-storyboard.ts --live
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseStorageService } from '../apps/server/src/services/firebase-storage';
import { STYLE } from './lib/ta-visual';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
if (process.argv.includes('--live')) delete process.env.FIRESTORE_EMULATOR_HOST;

const UNIVERSE_ID = 'H9E6T6KyaL4xZMhttKAprcayQGonswqUnvXmtcb8a9kL';
const CREATOR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const DRY_RUN = process.argv.includes('--dry-run');
const GOOGLE_API_KEY = process.env.GEN_GOOGLE_KEY?.trim() || process.env.GOOGLE_API_KEY;
const MODELS = ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview'];

// Same shot lists as gen-techno-antichrist-video.ts (kept local — these are
// text-to-video prompts repurposed as text-to-image; no need to import the
// video script, which has its own CLI/process.exit side effects).
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

async function generate(prompt: string): Promise<{ base64: string; mimeType: string }> {
  let lastErr = '';
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Generate an image: ${prompt} ${STYLE}` }] }],
            generationConfig: {
              responseModalities: ['image', 'text'],
              temperature: 1,
              imageConfig: { aspectRatio: '16:9' },
            },
          }),
        }
      );
      if (!res.ok) {
        lastErr = `${model} → ${res.status}: ${(await res.text()).slice(0, 200)}`;
        continue;
      }
      const data = (await res.json()) as any;
      for (const c of data.candidates ?? []) {
        for (const p of c.content?.parts ?? []) {
          if (p.inlineData?.data)
            return { base64: p.inlineData.data, mimeType: p.inlineData.mimeType || 'image/png' };
        }
      }
      lastErr = `${model} → no inlineData`;
    } catch (err: any) {
      lastErr = `${model} → ${err?.message ?? err}`;
    }
  }
  throw new Error(lastErr || 'all models failed');
}

async function host(base64: string, filename: string): Promise<string> {
  const buf = Buffer.from(base64, 'base64');
  const key = await firebaseStorageService.upload(buf, filename);
  return firebaseStorageService.getPublicUrl(key);
}

let db: FirebaseFirestore.Firestore;

async function exists(targetId: string, subCategory: string, sortOrder: number): Promise<boolean> {
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
      originalFilename: `${opts.subCategory}-${opts.sortOrder}.png`,
      mimeType: 'image/png',
      size: 0,
      url: opts.url,
      targetType: opts.targetType,
      targetId: opts.targetId,
      targetName: opts.targetName,
      category: 'image',
      label: opts.label,
      subCategory: opts.subCategory,
      version: 1,
      variantOf: null,
      variantLabel: 'nano-banana-storyboard',
      sortOrder: opts.sortOrder,
      generationId: null,
      creator: CREATOR,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
}

async function main() {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY / GEN_GOOGLE_KEY not in env');
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

  const entSnap = await db.collection('entities').where('universeAddress', '==', UNIVERSE_ID).get();
  const entities = entSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  console.log('\n' + '='.repeat(66));
  console.log('  Techno Antichrist — storyboard stills (Nano Banana, no quota wall)');
  console.log('='.repeat(66));
  console.log(`  Dry run: ${DRY_RUN}\n`);

  let ok = 0;
  let fail = 0;

  for (const [epName, shots] of Object.entries(EPISODE_SHOTS)) {
    const ent = entities.find((e) => e.name === epName);
    if (!ent) {
      console.log(`  ! no entity "${epName}" — skipping`);
      continue;
    }
    console.log(`  ${epName}`);
    for (let idx = 0; idx < shots.length; idx++) {
      const i = idx + 1;
      if (await exists(ent.id, 'ta-storyboard', i)) {
        console.log(`      · ${i} exists — skip`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`      ${i} would generate: ${shots[idx].slice(0, 80)}…`);
        continue;
      }
      try {
        const img = await generate(shots[idx]);
        const url = await host(img.base64, `ta-storyboard-${slug(epName)}-shot${i}.png`);
        await attach({
          url,
          targetType: 'entity',
          targetId: ent.id,
          targetName: epName,
          label: `${epName} — storyboard shot ${i}`,
          subCategory: 'ta-storyboard',
          sortOrder: i,
        });
        console.log(`      ${i} ✓ ${url}`);
        ok++;
      } catch (err: any) {
        console.log(`      ${i} ✗ ${err?.message?.slice(0, 160) ?? err}`);
        fail++;
      }
      await sleep(800);
    }
  }

  console.log(`\n  trailer: ${TRAILER.length} beats`);
  for (let idx = 0; idx < TRAILER.length; idx++) {
    const i = idx + 1;
    if (await exists(UNIVERSE_ID, 'ta-trailer-storyboard', i)) {
      console.log(`      · ${i} exists — skip`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`      ${i} would generate: ${TRAILER[idx].slice(0, 80)}…`);
      continue;
    }
    try {
      const img = await generate(TRAILER[idx]);
      const url = await host(
        img.base64,
        `ta-trailer-storyboard-shot${String(i).padStart(2, '0')}.png`
      );
      await attach({
        url,
        targetType: 'universe',
        targetId: UNIVERSE_ID,
        targetName: 'Techno Antichrist',
        label: `Trailer — storyboard beat ${i}`,
        subCategory: 'ta-trailer-storyboard',
        sortOrder: i,
      });
      console.log(`      ${i} ✓ ${url}`);
      ok++;
    } catch (err: any) {
      console.log(`      ${i} ✗ ${err?.message?.slice(0, 160) ?? err}`);
      fail++;
    }
    await sleep(800);
  }

  console.log(`\n  done — ${ok} ok, ${fail} failed`);
  console.log(`  /universe/${UNIVERSE_ID}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});

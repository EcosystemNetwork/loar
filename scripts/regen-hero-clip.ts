/**
 * Generate one hero video clip for a single universe via fal.ai, pin to
 * Pinata, and wire it into the platform so it appears on:
 *   - the landing page rail (episodes.feed)
 *   - the universe's watch page (offChainNodes)
 *   - the gallery (content)
 *
 * Usage:
 *   pnpm tsx scripts/regen-hero-clip.ts <universeAddr>            # generate
 *   pnpm tsx scripts/regen-hero-clip.ts <universeAddr> --dry-run  # build prompt only
 *
 * Cost: one fal kling-video v2.5-turbo call ≈ $0.45.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'fs';
import * as fal from '@fal-ai/serverless-client';
import { randomUUID, createHash } from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DRY = process.argv.includes('--dry-run');
const fromFileIdx = process.argv.indexOf('--from-file');
const FROM_FILE = fromFileIdx !== -1 ? process.argv[fromFileIdx + 1] : null;
const universeAddr = (process.argv.find((a) => a.startsWith('0x')) || '').toLowerCase();
if (!universeAddr) {
  console.error('Usage: pnpm tsx scripts/regen-hero-clip.ts <universeAddr> [--dry-run]');
  process.exit(1);
}

const FAL_MODEL = 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video';
// Server-side platform creator UID (matches the visible-universes creator)
const PLATFORM_CREATOR = '0x80baf7fffc430cdaced4f1d673f4138d6d493077';

function initDb() {
  const existing = getApps()[0];
  if (existing) return getFirestore(existing);
  const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
  const app = initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  return db;
}

async function pickHeroScene(db: FirebaseFirestore.Firestore, addr: string) {
  const uDoc = await db.collection('cinematicUniverses').doc(addr).get();
  if (!uDoc.exists) throw new Error(`universe ${addr} not found`);
  const u = uDoc.data() as any;

  const entSnap = await db.collection('entities').where('universeAddress', '==', addr).get();
  const ents = entSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  // Heuristic: look for a hero "place" + a hero "person" / "thing" by simple
  // signal — longer descriptions tend to be more central to the story.
  const persons = ents
    .filter((e) => e.kind === 'person')
    .sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0));
  const places = ents
    .filter((e) => e.kind === 'place')
    .sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0));
  const things = ents
    .filter((e) => e.kind === 'thing' || e.kind === 'technology' || e.kind === 'vehicle')
    .sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0));

  // Hero composition: pick a thing/tech/vehicle as the focal subject when
  // available (stronger visual anchor than people for an establishing shot),
  // then find a place whose name appears in the subject's description so the
  // setting actually fits. Falls back to longest-described place when no
  // cross-reference exists.
  const subject = things[0] || persons[0];
  const subjectDesc = String(subject?.description || '').toLowerCase();
  const referencedPlace = places.find(
    (p) => p.name && subjectDesc.includes(String(p.name).toLowerCase())
  );
  const place = referencedPlace || places[0];

  // Style cue extracted from universe description: prefer the first 200 chars
  // since universe descriptions usually open with tone/style language.
  const styleCue = String(u.description || '')
    .replace(/\s+/g, ' ')
    .slice(0, 240);

  const promptLines = [
    `Cinematic establishing shot from "${u.name}".`,
    place ? `Setting: ${place.name} — ${String(place.description || '').slice(0, 220)}` : null,
    subject ? `Focus: ${subject.name} — ${String(subject.description || '').slice(0, 220)}` : null,
    `Tone: ${styleCue}`,
    `Camera: slow dolly-in, atmospheric lighting, 5 seconds, no on-screen text.`,
  ].filter(Boolean);

  return {
    universe: { id: uDoc.id, ...(u as any) },
    place,
    subject,
    prompt: promptLines.join('\n'),
  };
}

/**
 * Persist via Firebase Storage / GCS. Pinata's JWT is currently invalid and
 * Lighthouse is unreachable from this network — Firebase is the most
 * reliable provider available right now and produces a `storage.googleapis.com`
 * URL that is NOT on the ephemeral host list, so it survives the
 * backfill-hide-* sweepers.
 */
async function pinToFirebaseStorage(buffer: Buffer, filename: string, mimeType: string) {
  // .env has the legacy `loar-db.appspot.com` name; the real GCS bucket lives
  // at `loar-db.firebasestorage.app` (Firebase migrated naming in 2024).
  // Hardcoded here so this script doesn't depend on a server-runtime env fix.
  const bucketName = 'loar-db.firebasestorage.app';
  const safeName = filename.replace(/[/\\.\s]+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `videos/${Date.now()}-${safeName}`;
  const bucket = getStorage().bucket(bucketName);
  const file = bucket.file(key);
  await file.save(buffer, {
    contentType: mimeType,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();
  const url = `https://storage.googleapis.com/${bucketName}/${key}`;
  const sha = createHash('sha256').update(buffer).digest('hex');
  return { url, cid: key, size: buffer.length, sha };
}

async function generateVideo(prompt: string): Promise<{ videoUrl: string; rawDuration?: number }> {
  fal.config({ credentials: process.env.FAL_KEY });
  console.log(`[fal] submitting to ${FAL_MODEL}…`);
  const result = (await fal.subscribe(FAL_MODEL, {
    input: {
      prompt,
      duration: '5',
      aspect_ratio: '16:9',
      negative_prompt: 'text, watermark, logo, captions, subtitles',
    },
    logs: false,
  })) as any;
  // kling-turbo response shape: { video: { url } }
  const url = result?.video?.url || result?.videoUrl || result?.url;
  if (!url) throw new Error(`fal returned no video url: ${JSON.stringify(result).slice(0, 400)}`);
  return { videoUrl: url };
}

async function main() {
  const db = initDb();
  const scene = await pickHeroScene(db, universeAddr);

  console.log(`\n──── ${scene.universe.name} (${universeAddr.slice(0, 10)}…) ────`);
  console.log(`Place:   ${scene.place?.name ?? '—'}`);
  console.log(`Subject: ${scene.subject?.name ?? '—'}`);
  console.log(`\nPrompt:\n${scene.prompt}\n`);

  if (DRY) {
    console.log('[dry-run] no API calls. Re-run without --dry-run to generate.');
    return;
  }

  // 1. fal video — or use a previously-saved local file
  let buf: Buffer;
  if (FROM_FILE) {
    console.log(`[fal] skipping (using ${FROM_FILE})`);
    buf = readFileSync(FROM_FILE);
  } else {
    const t0 = Date.now();
    const { videoUrl: ephemeralUrl } = await generateVideo(scene.prompt);
    console.log(`[fal] done in ${Math.round((Date.now() - t0) / 1000)}s — ${ephemeralUrl}`);
    console.log(`[storage] downloading + uploading to Firebase Storage…`);
    const dlRes = await fetch(ephemeralUrl);
    if (!dlRes.ok) throw new Error(`download failed: HTTP ${dlRes.status}`);
    buf = Buffer.from(await dlRes.arrayBuffer());
  }

  // 2. persist to Firebase Storage
  const pinned = await pinToFirebaseStorage(
    buf,
    `hero-${scene.universe.name.replace(/\s+/g, '-')}.mp4`,
    'video/mp4'
  );
  console.log(`[storage] uploaded: ${pinned.url}  (${(pinned.size / 1024 / 1024).toFixed(2)} MB)`);

  // 3. write content doc (gallery)
  const generationId = randomUUID();
  const now = new Date();
  const contentRef = await db.collection('content').add({
    title: `${scene.universe.name} — Hero Scene`,
    description: scene.prompt,
    mediaUrl: pinned.url,
    thumbnailUrl: pinned.url,
    mediaType: 'ai-video',
    classification: 'original',
    tags: ['hero', 'auto-generated'],
    ipDeclaration: {
      isOriginal: true,
      usesCopyrightedMaterial: false,
      license: 'all-rights-reserved',
    },
    visibility: 'public',
    creatorUid: PLATFORM_CREATOR,
    universeId: universeAddr,
    createdAt: now,
    updatedAt: now,
    views: 0,
    likes: 0,
    reviewStatus: 'not_required',
    generationId,
    generationModel: FAL_MODEL,
    storageContentHash: pinned.sha,
  });
  console.log(`[content] wrote doc ${contentRef.id}`);

  // 4. write offChainNode doc (universe's watch page)
  const counterRef = db.collection('offChainNodeCounters').doc(universeAddr);
  const nodeId = await db.runTransaction(async (tx) => {
    const cur = await tx.get(counterRef);
    const next = (cur.exists ? (cur.data()?.next as number) : 1) ?? 1;
    tx.set(counterRef, { next: next + 1 }, { merge: true });
    return next;
  });
  const offChainRef = db.collection('offChainNodes').doc(`${universeAddr}:${nodeId}`);
  await offChainRef.set({
    universeId: universeAddr,
    nodeId,
    videoUrl: pinned.url,
    label: `${scene.universe.name} — Hero Scene`,
    createdAt: now,
    creator: PLATFORM_CREATOR,
    contentId: contentRef.id,
    generationId,
  });
  console.log(`[offChainNode] wrote ${universeAddr}:${nodeId}`);

  // 5. write episode doc (landing page rail)
  const episodeId = randomUUID();
  await db
    .collection('episodes')
    .doc(episodeId)
    .set({
      id: episodeId,
      universeId: universeAddr,
      title: `${scene.universe.name} — Pilot`,
      description: scene.prompt.split('\n').slice(0, 2).join(' '),
      isCanon: true,
      clipCount: 1,
      clips: [
        {
          nodeId: String(nodeId),
          label: 'Hero Scene',
          videoUrl: pinned.url,
        },
      ],
      sourceCreator: PLATFORM_CREATOR,
      createdAt: FieldValue.serverTimestamp(),
    });
  console.log(`[episode] wrote ${episodeId} (isCanon=true)`);

  console.log(`\n✓ ${scene.universe.name} now has a canon episode on the landing rail.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

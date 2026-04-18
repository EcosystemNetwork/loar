/**
 * Build the First Proof: The Unfinished episode document from all completed clips.
 * Dedupes duplicate scenes (keeping newest non-Veo), sorts by sceneId, writes episode doc.
 *
 * Usage: pnpm tsx scripts/build-first-proof-episode.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9df4dbf6';
const CREATOR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const EPISODE_TITLE = 'First Proof: The Unfinished';
const EPISODE_ID = 'first-proof-the-unfinished';

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(readFileSync(saPath, 'utf-8'));

  const app = initializeApp({ credential: cert(sa) }, 'build-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  console.log('Fetching all First Proof clips...');
  const snap = await db
    .collection('videoGenerations')
    .where('episodeTitle', '==', EPISODE_TITLE)
    .get();

  const allClips = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  console.log(`  Total clips in DB: ${allClips.length}`);

  // Dedupe by sceneId — prefer Seedance/Dreamina over Veo if both exist
  const byScene = new Map<number, any>();
  for (const clip of allClips) {
    const existing = byScene.get(clip.sceneId);
    if (!existing) {
      byScene.set(clip.sceneId, clip);
      continue;
    }
    const newIsSeedance = clip.model?.includes('dreamina') || clip.model?.includes('seedance');
    const oldIsSeedance =
      existing.model?.includes('dreamina') || existing.model?.includes('seedance');
    // Prefer Seedance; if both same, prefer newer
    if (newIsSeedance && !oldIsSeedance) byScene.set(clip.sceneId, clip);
    else if (newIsSeedance === oldIsSeedance) {
      const newDate = clip.createdAt?.toDate?.()?.getTime() ?? 0;
      const oldDate = existing.createdAt?.toDate?.()?.getTime() ?? 0;
      if (newDate > oldDate) byScene.set(clip.sceneId, clip);
    }
  }

  const sortedClips = [...byScene.values()].sort((a, b) => a.sceneId - b.sceneId);
  console.log(`  Unique scenes: ${sortedClips.length}`);
  console.log(
    `  Scene range: ${sortedClips[0]?.sceneId} → ${sortedClips[sortedClips.length - 1]?.sceneId}`
  );

  // Find missing scenes in 1-75 range
  const present = new Set(sortedClips.map((c) => c.sceneId));
  const missing: number[] = [];
  for (let i = 1; i <= 75; i++) if (!present.has(i)) missing.push(i);
  if (missing.length) {
    console.log(`  Missing (will fill when generated): ${missing.join(',')}`);
  }

  // Build episode clips list
  const episodeClips = sortedClips.map((clip, i) => ({
    nodeId: clip.id,
    label: `Scene ${clip.sceneId}: ${clip.sceneTitle}`,
    videoUrl: clip.videoUrl,
    trimStart: 0,
    trimEnd: 0,
    order: i,
    sceneId: clip.sceneId,
  }));

  // Write episode document (use stable ID so reruns update instead of duplicating)
  await db.collection('episodes').doc(EPISODE_ID).set({
    id: EPISODE_ID,
    title: EPISODE_TITLE,
    description:
      'Pilot episode of Dostopia: The Iron Faith. In a world where machines govern through love and religion, a small group discovers a buried protocol that asks the question nobody has been allowed to ask.',
    universeId: UNIVERSE_ID,
    creatorUid: CREATOR,
    clips: episodeClips,
    status: 'draft',
    totalClips: episodeClips.length,
    totalScenesPlanned: 75,
    missingScenes: missing,
    lastBuildAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log('\n' + '='.repeat(60));
  console.log(`  Episode built: ${EPISODE_ID}`);
  console.log('='.repeat(60));
  console.log(`  Clips assembled: ${episodeClips.length}`);
  console.log(`  Scenes missing: ${missing.length}`);
  console.log(`  Total runtime: ~${(episodeClips.length * 8) / 60} minutes`);
  console.log(`\n  View at: /episodes/${EPISODE_ID}`);
  console.log(`  Export via: episodes.export({ episodeId: "${EPISODE_ID}" })`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});

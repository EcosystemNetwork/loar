/**
 * Dedupe Scene 1 of First Proof episode:
 *   - Keep the Seedance 2.0 version as the canonical episode clip
 *   - Remove the Veo 3.1 duplicates from videoGenerations (source of truth for episode)
 *   - Leave them in the content/gallery collection (they were already published there)
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(readFileSync(saPath, 'utf-8'));

  const app = initializeApp({ credential: cert(sa) }, 'dedupe-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  // Find Scene 1 clips for First Proof
  const snap = await db
    .collection('videoGenerations')
    .where('episodeTitle', '==', 'First Proof: The Unfinished')
    .get();

  const scene1 = snap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }))
    .filter((c) => c.sceneId === 1);

  console.log(`Found ${scene1.length} Scene 1 clips`);

  const seedance = scene1.find(
    (c) => c.model?.includes('seedance') || c.model?.includes('dreamina')
  );
  const veos = scene1.filter(
    (c) => !c.model?.includes('seedance') && !c.model?.includes('dreamina')
  );

  if (!seedance) {
    console.error('No Seedance Scene 1 found — aborting to avoid losing the scene entirely');
    process.exit(1);
  }

  console.log(`  Canonical (Seedance): ${seedance.id}`);
  console.log(`  Duplicates to remove (Veo): ${veos.length}`);

  // Delete the Veo duplicates from videoGenerations
  // (they remain in the `content` collection as gallery items)
  for (const v of veos) {
    await v.ref.delete();
    console.log(`  Deleted videoGenerations/${v.id} (${v.model})`);
  }

  // Verify the content gallery entries still exist
  const contentSnap = await db
    .collection('content')
    .where('tags', 'array-contains', 'first-proof')
    .get();
  const scene1Content = contentSnap.docs.filter((d) => {
    const tags = (d.data() as any).tags || [];
    return tags.includes('scene-1');
  });
  console.log(`\nGallery content entries for Scene 1: ${scene1Content.length}`);
  scene1Content.forEach((d) => {
    const x = d.data() as any;
    console.log(`  ${d.id} — ${x.generationModel} — ${x.mediaUrl.slice(0, 60)}...`);
  });

  console.log('\nDone. Seedance Scene 1 is now canonical; Veo versions remain in gallery.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

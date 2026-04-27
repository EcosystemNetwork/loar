/**
 * Flip isCanon=true on episode docs for visible universes that have multi-clip
 * episodes already in Firestore but were never published. Aligns the landing
 * rail with the existing content (Fogline 4, Dostopia 3, Monerochan 2).
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const APPLY = process.argv.includes('--apply');

async function main() {
  const existing = getApps()[0];
  let db;
  if (existing) {
    db = getFirestore(existing);
  } else {
    const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
    const app = initializeApp({ credential: cert(sa) });
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  const uSnap = await db.collection('cinematicUniverses').get();
  const visibleUniverses = uSnap.docs.filter((d) => {
    const x = d.data() as any;
    return !x.isHidden && !x.isPrivate;
  });
  console.log(`scanning episodes for ${visibleUniverses.length} visible universes`);

  let flipped = 0;
  for (const uDoc of visibleUniverses) {
    const addr = ((uDoc.data() as any).address || uDoc.id || '').toLowerCase();
    if (!addr) continue;
    const epSnap = await db.collection('episodes').where('universeId', '==', addr).get();
    const drafts = epSnap.docs.filter((d) => (d.data() as any).isCanon !== true);
    if (drafts.length === 0) continue;
    // Only flip episodes that have at least one clip with a videoUrl —
    // never canonize an empty episode.
    const playable = drafts.filter((d) => {
      const clips = (d.data() as any).clips;
      return Array.isArray(clips) && clips.some((c: any) => !!c?.videoUrl);
    });
    console.log(
      `  ${(uDoc.data() as any).name?.padEnd(28)} ${addr.slice(0, 10)}…  drafts=${drafts.length}  playable=${playable.length}`
    );
    if (!APPLY) continue;
    for (const ep of playable) {
      await ep.ref.update({ isCanon: true, canonizedAt: new Date().toISOString() });
      flipped++;
    }
  }
  console.log(`\n${APPLY ? 'flipped' : 'would flip'} ${flipped} episodes to canon`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

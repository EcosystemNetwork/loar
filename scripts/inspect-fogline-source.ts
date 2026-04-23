/**
 * Inspect Fogline & Dostopia content docs + their backing generation docs
 * to find where the real video data lives.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
  const app = getApps()[0] || initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  for (const uni of [{ name: 'Fogline', addr: '0x0000000000000000000000000000019d9e26795c' }]) {
    console.log(`\n═══ ${uni.name} (${uni.addr}) ═══\n`);
    const snap = await db.collection('content').where('universeId', '==', uni.addr).limit(5).get();

    for (const doc of snap.docs) {
      const d = doc.data() as any;
      console.log(`content: ${doc.id.slice(0, 8)}  generationId: ${d.generationId}`);
      console.log(`  title: ${(d.title || '').slice(0, 50)}`);
      console.log(`  mediaUrl: ${d.mediaUrl}`);
      console.log(`  status: ${d.contentStatus}`);

      if (d.generationId) {
        // Clean the generationId (some have :2d suffix)
        const genId = String(d.generationId).split(':')[0];
        const gens = await db.collection('generations').where('id', '==', genId).limit(1).get();
        // Also try by doc id (generations may be keyed by id)
        let genDoc;
        if (!gens.empty) {
          genDoc = gens.docs[0];
        } else {
          const byId = await db.collection('generations').doc(genId).get();
          if (byId.exists) genDoc = byId;
        }

        if (genDoc) {
          const g = genDoc.data()!;
          console.log(`  gen.videoUrl: ${g.videoUrl?.slice(0, 80) || '(none)'}`);
          console.log(`  gen.permanentVideoUrl: ${g.permanentVideoUrl?.slice(0, 80) || '(none)'}`);
          console.log(
            `  gen.imageUrl: ${g.imageUrl?.slice(0, 80) || '(none)'}  gen.status: ${g.status}`
          );
        } else {
          console.log(`  (no generation doc for ${genId})`);
        }
      }
      console.log();
    }

    // Also check videoGenerations collection
    console.log('\n--- videoGenerations for this universe ---');
    const vgSnap = await db
      .collection('videoGenerations')
      .where('universeId', '==', uni.addr)
      .limit(3)
      .get();
    console.log(`videoGenerations: ${vgSnap.size}`);
    for (const doc of vgSnap.docs) {
      const d = doc.data() as any;
      console.log(`  ${doc.id.slice(0, 10)}  videoUrl=${d.videoUrl?.slice(0, 70)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

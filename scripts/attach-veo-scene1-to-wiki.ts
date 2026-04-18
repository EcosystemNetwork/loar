/**
 * Attach the two Veo Scene 1 clips to wiki entities (Nova Geneva + Overmind Collective)
 * and the Dostopia universe so they appear on those wiki pages' Media tabs.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9df4dbf6';
const CREATOR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(readFileSync(saPath, 'utf-8'));

  const app = initializeApp({ credential: cert(sa) }, 'attach-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  // Find the Veo Scene 1 content records (already in gallery with Pinata URLs)
  const contentSnap = await db
    .collection('content')
    .where('tags', 'array-contains', 'first-proof')
    .get();

  const veoScene1 = contentSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((c) => {
      const tags = c.tags || [];
      return tags.includes('scene-1') && c.generationModel?.includes('veo');
    });

  if (veoScene1.length === 0) {
    console.error('No Veo Scene 1 clips found in content gallery');
    process.exit(1);
  }

  console.log(`Found ${veoScene1.length} Veo Scene 1 clips to attach`);

  // Find target entities (Nova Geneva + Overmind Collective)
  const entitiesSnap = await db
    .collection('entities')
    .where('universeAddress', '==', UNIVERSE_ID)
    .get();

  const allEntities = entitiesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const targets = [
    allEntities.find((e) => e.name === 'Nova Geneva'),
    allEntities.find((e) => e.name === 'The Overmind Collective'),
  ].filter(Boolean);

  console.log(`Target entities: ${targets.map((t) => t.name).join(', ')}`);

  let attached = 0;

  // Attach each Veo clip to each target entity + the universe
  for (const clip of veoScene1) {
    for (const entity of targets) {
      const attachId = randomUUID();
      await db
        .collection('mediaAttachments')
        .doc(attachId)
        .set({
          contentHash: clip.generationId ?? clip.id,
          originalFilename: `first-proof-scene-1-veo.mp4`,
          mimeType: 'video/mp4',
          size: 0,
          url: clip.mediaUrl,
          targetType: 'entity',
          targetId: entity.id,
          targetName: entity.name,
          category: 'video',
          label: 'Nova Geneva Dawn (Veo 3.1 variant)',
          subCategory: 'first-proof-pilot',
          version: 1,
          variantOf: null,
          variantLabel: 'veo3.1-fast',
          sortOrder: 0,
          generationId: clip.generationId ?? null,
          creator: CREATOR,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      attached++;
      console.log(`  Attached to entity: ${entity.name}`);
    }

    // Also attach to universe
    const universeAttachId = randomUUID();
    await db
      .collection('mediaAttachments')
      .doc(universeAttachId)
      .set({
        contentHash: clip.generationId ?? clip.id,
        originalFilename: `first-proof-scene-1-veo.mp4`,
        mimeType: 'video/mp4',
        size: 0,
        url: clip.mediaUrl,
        targetType: 'universe',
        targetId: UNIVERSE_ID,
        targetName: 'Dostopia: The Iron Faith',
        category: 'video',
        label: 'Nova Geneva Dawn (Veo 3.1 variant)',
        subCategory: 'first-proof-pilot',
        version: 1,
        variantOf: null,
        variantLabel: 'veo3.1-fast',
        sortOrder: 0,
        generationId: clip.generationId ?? null,
        creator: CREATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    attached++;
    console.log(`  Attached to universe: Dostopia`);
  }

  console.log(`\nDone. ${attached} attachments created.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

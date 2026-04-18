/**
 * Consolidate all Fogline data onto the canonical universe ID.
 *
 *   Canonical: 0x0000000000000000000000000000019d9e26795c
 *
 * Actions:
 *   1. Move orphan offChainNodes to the canonical universe (re-numbering nodeIds sequentially)
 *   2. Delete duplicate Fogline universe doc (the empty one)
 *   3. Move any orphan videoGenerations / content to canonical
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));

const app = initializeApp({ credential: cert(serviceAccount) }, `consolidate-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

const CANONICAL = '0x0000000000000000000000000000019d9e26795c';
const DUPLICATE_UNIVERSES = ['0x0000000000000000000000000000019d9dfd4384'];
const ORPHAN_NODE_UNIVERSES = [
  '0x0000000000000000000000000000019d9df4dbf6',
  '0x0000000000000000000000000000019d9e5d6003',
];

async function main() {
  console.log('\n══════════════════════════════════════════');
  console.log('  Fogline Consolidation');
  console.log('══════════════════════════════════════════');
  console.log(`  Canonical: ${CANONICAL}`);
  console.log('');

  // Step 1: Get current canonical state
  const canonNodes = await db
    .collection('offChainNodes')
    .where('universeId', '==', CANONICAL)
    .get();
  console.log(`Step 1: Canonical universe has ${canonNodes.size} nodes`);

  // Find max nodeId on canonical
  let maxNodeId = 0;
  for (const doc of canonNodes.docs) {
    const nid = doc.data().nodeId as number;
    if (nid > maxNodeId) maxNodeId = nid;
  }
  console.log(`  Max nodeId on canonical: ${maxNodeId}`);

  // Step 2: Migrate orphan nodes to canonical with re-numbered nodeIds
  console.log('\nStep 2: Migrating orphan nodes...');
  let nextId = maxNodeId + 1;
  const allOrphanNodes: Array<{ id: string; data: any; oldNodeId: number }> = [];

  for (const orphanUid of ORPHAN_NODE_UNIVERSES) {
    const snap = await db.collection('offChainNodes').where('universeId', '==', orphanUid).get();
    console.log(`  ${orphanUid}: ${snap.size} nodes`);
    for (const doc of snap.docs) {
      allOrphanNodes.push({
        id: doc.id,
        data: doc.data(),
        oldNodeId: doc.data().nodeId,
      });
    }
  }

  // Sort by sceneId so they're chronologically continuous
  allOrphanNodes.sort((a, b) => {
    const as = a.data.sceneId ?? 99999;
    const bs = b.data.sceneId ?? 99999;
    return as - bs;
  });

  // Filter to scenes not already on canonical (avoid duplicates by sceneId)
  const canonScenes = new Set(canonNodes.docs.map((d) => d.data().sceneId).filter(Boolean));
  const toMigrate = allOrphanNodes.filter((n) => !canonScenes.has(n.data.sceneId));
  const toDelete = allOrphanNodes.filter((n) => canonScenes.has(n.data.sceneId));

  console.log(`  ${toMigrate.length} orphan nodes will move to canonical (new sceneIds)`);
  console.log(`  ${toDelete.length} orphan nodes are duplicates of canonical scenes — will delete`);

  // Migrate
  let lastNodeId = maxNodeId;
  for (const orphan of toMigrate) {
    const newNodeId = nextId++;
    const previousNodeId = lastNodeId;
    lastNodeId = newNodeId;

    await db.collection('offChainNodes').doc(orphan.id).update({
      universeId: CANONICAL,
      nodeId: newNodeId,
      previousNodeId,
      updatedAt: new Date(),
    });
    console.log(`    [${newNodeId}] Scene ${orphan.data.sceneId}: ${orphan.data.title}`);
  }

  // Delete duplicates
  for (const dup of toDelete) {
    await db.collection('offChainNodes').doc(dup.id).delete();
    console.log(`    [del] Scene ${dup.data.sceneId} (already on canonical)`);
  }

  // Update counter
  if (lastNodeId > maxNodeId) {
    await db
      .collection('offChainNodeCounters')
      .doc(CANONICAL)
      .set({ latest: lastNodeId, updatedAt: new Date() }, { merge: true });
    console.log(`  Counter updated: latest = ${lastNodeId}`);
  }

  // Step 3: Move orphan content/videoGenerations
  console.log('\nStep 3: Migrating orphan video generations and content...');
  for (const orphanUid of ORPHAN_NODE_UNIVERSES) {
    const vids = await db.collection('videoGenerations').where('universeId', '==', orphanUid).get();
    if (vids.size > 0) {
      const batch = db.batch();
      vids.docs.forEach((d) => batch.update(d.ref, { universeId: CANONICAL }));
      await batch.commit();
      console.log(`  ${orphanUid}: ${vids.size} videoGenerations migrated`);
    }
    const content = await db.collection('content').where('universeId', '==', orphanUid).get();
    if (content.size > 0) {
      const batch = db.batch();
      content.docs.forEach((d) =>
        batch.update(d.ref, { universeId: CANONICAL, updatedAt: new Date() })
      );
      await batch.commit();
      console.log(`  ${orphanUid}: ${content.size} content items migrated`);
    }
  }

  // Delete orphan counters
  for (const orphanUid of ORPHAN_NODE_UNIVERSES) {
    const counterDoc = await db.collection('offChainNodeCounters').doc(orphanUid).get();
    if (counterDoc.exists) {
      await db.collection('offChainNodeCounters').doc(orphanUid).delete();
      console.log(`  Deleted orphan counter: ${orphanUid}`);
    }
  }

  // Step 4: Delete duplicate Fogline universes
  console.log('\nStep 4: Deleting duplicate Fogline universe docs...');
  for (const dupUid of DUPLICATE_UNIVERSES) {
    // First, move any entities from the duplicate to canonical (avoiding duplicates by name)
    const dupEntities = await db
      .collection('entities')
      .where('universeAddress', '==', dupUid)
      .get();
    if (dupEntities.size > 0) {
      const canonEntitiesSnap = await db
        .collection('entities')
        .where('universeAddress', '==', CANONICAL)
        .get();
      const canonNames = new Set(canonEntitiesSnap.docs.map((d) => d.data().name?.toLowerCase()));

      for (const dupEntity of dupEntities.docs) {
        const name = dupEntity.data().name?.toLowerCase();
        if (name && canonNames.has(name)) {
          // Already exists on canonical — delete the duplicate
          await dupEntity.ref.delete();
        } else {
          // Move to canonical
          await dupEntity.ref.update({ universeAddress: CANONICAL, updatedAt: new Date() });
        }
      }
      console.log(`  ${dupUid}: ${dupEntities.size} entities reconciled`);
    }

    // Delete duplicate universe doc
    await db.collection('cinematicUniverses').doc(dupUid).delete();
    console.log(`  Deleted universe doc: ${dupUid}`);

    // Delete its credits / privateSection
    await db
      .collection('universeCredits')
      .doc(dupUid)
      .delete()
      .catch(() => {});
    await db
      .collection('privateSectionConfig')
      .doc(dupUid)
      .delete()
      .catch(() => {});
  }

  // Final report
  console.log('\n══════════════════════════════════════════');
  console.log('  Final State');
  console.log('══════════════════════════════════════════');
  const finalNodes = await db
    .collection('offChainNodes')
    .where('universeId', '==', CANONICAL)
    .get();
  const finalEntities = await db
    .collection('entities')
    .where('universeAddress', '==', CANONICAL)
    .get();
  const finalVids = await db
    .collection('videoGenerations')
    .where('universeId', '==', CANONICAL)
    .get();
  const finalUniverses = (await db.collection('cinematicUniverses').get()).docs.filter((d) => {
    const n = (d.data().name || '').toLowerCase();
    return n.includes('fogline') || n.includes('fallout');
  });
  console.log(`  Universes: ${finalUniverses.length}`);
  console.log(`  Entities:  ${finalEntities.size}`);
  console.log(`  Nodes:     ${finalNodes.size}`);
  console.log(`  Videos:    ${finalVids.size}`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

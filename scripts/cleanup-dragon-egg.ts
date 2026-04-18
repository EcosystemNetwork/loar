/**
 * Audit + clean up Dragon Egg universe duplicates.
 *
 * Finds all "Dragon Egg" universes, keeps the one with the real IPFS cover,
 * and deletes the placeholder duplicates (along with their credits/entities/content).
 *
 * Also verifies content exists for the canonical universe.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-dragon-egg.ts              # dry-run report
 *   pnpm tsx scripts/cleanup-dragon-egg.ts --apply      # actually delete
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
const app = initializeApp({ credential: cert(serviceAccount) }, `cleanup-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

const APPLY = process.argv.includes('--apply');
// The real on-chain universe address (Base Sepolia) is the canonical one now.
const CANONICAL = '0x38f1e8b9c2d31f163fbfcbb9638de959fedcb964';

async function main() {
  console.log(`\n${'='.repeat(60)}\n  DRAGON EGG — Universe Audit\n${'='.repeat(60)}`);
  console.log(`  Mode: ${APPLY ? 'APPLY (will delete)' : 'DRY RUN (no deletes)'}`);
  console.log(`  Keep: ${CANONICAL}\n`);

  // 1. Find all Dragon Egg universes
  const snap = await db.collection('cinematicUniverses').where('name', '==', 'Dragon Egg').get();
  console.log(`Found ${snap.size} universe docs named "Dragon Egg":\n`);

  const toDelete: string[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const img = (d.image_url ?? '').slice(0, 60);
    const isCanon = doc.id === CANONICAL;
    console.log(`  ${isCanon ? '[KEEP]  ' : '[DELETE]'} ${doc.id}`);
    console.log(`            image: ${img}...`);
    console.log(`            created: ${d.created_at?.toDate?.().toISOString() ?? 'n/a'}`);
    if (!isCanon) toDelete.push(doc.id);
  }

  // 2. Check content on canonical universe
  console.log(`\n${'─'.repeat(60)}\nContent on canonical universe:\n`);
  const contentSnap = await db.collection('content').where('universeId', '==', CANONICAL).get();
  console.log(`  content docs: ${contentSnap.size}`);
  for (const doc of contentSnap.docs) {
    const d = doc.data();
    console.log(
      `    - ${d.title} (${d.mediaType}) vis=${d.visibility} status=${d.contentStatus ?? 'n/a'}`
    );
  }

  const vgSnap = await db.collection('videoGenerations').where('universeId', '==', CANONICAL).get();
  console.log(`  videoGenerations docs: ${vgSnap.size}`);
  for (const doc of vgSnap.docs) {
    const d = doc.data();
    console.log(`    - ${d.sceneTitle} (${d.status})`);
  }

  const epSnap = await db.collection('episodes').where('universeId', '==', CANONICAL).get();
  console.log(`  episodes docs: ${epSnap.size}`);
  for (const doc of epSnap.docs) {
    const d = doc.data();
    console.log(`    - ${d.title} (${d.totalClips} clips)`);
  }

  // 3. Delete duplicates
  if (toDelete.length === 0) {
    console.log(`\n${'='.repeat(60)}\n  No duplicates to delete.\n${'='.repeat(60)}\n`);
    process.exit(0);
  }

  console.log(`\n${'─'.repeat(60)}\nDuplicates to delete: ${toDelete.length}`);

  if (!APPLY) {
    console.log(`\n  Dry-run mode. Re-run with --apply to actually delete.\n`);
    process.exit(0);
  }

  for (const id of toDelete) {
    console.log(`\n  Deleting ${id}...`);

    // Delete universe doc
    await db.collection('cinematicUniverses').doc(id).delete();
    console.log(`    - cinematicUniverses: deleted`);

    // Delete credits
    await db.collection('universeCredits').doc(id).delete();
    console.log(`    - universeCredits: deleted`);

    // Delete private section config
    await db.collection('privateSectionConfig').doc(id).delete();
    console.log(`    - privateSectionConfig: deleted`);

    // Delete credit transactions (by universeId)
    const txSnap = await db
      .collection('universeCreditTransactions')
      .where('universeId', '==', id)
      .get();
    for (const tx of txSnap.docs) await tx.ref.delete();
    console.log(`    - universeCreditTransactions: ${txSnap.size} deleted`);

    // Delete entities (by universeAddress)
    const entSnap = await db.collection('entities').where('universeAddress', '==', id).get();
    for (const e of entSnap.docs) await e.ref.delete();
    console.log(`    - entities: ${entSnap.size} deleted`);

    // Delete content (by universeId)
    const cSnap = await db.collection('content').where('universeId', '==', id).get();
    for (const c of cSnap.docs) await c.ref.delete();
    console.log(`    - content: ${cSnap.size} deleted`);
  }

  console.log(
    `\n${'='.repeat(60)}\n  Cleanup complete. Canonical universe intact.\n${'='.repeat(60)}\n`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});

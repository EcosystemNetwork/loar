/**
 * Delete a universe and its associated entities from Firestore.
 * Usage: pnpm tsx scripts/delete-universe.ts <universeId>
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const universeId = process.argv[2];
  if (!universeId) {
    console.error('Usage: pnpm tsx scripts/delete-universe.ts <universeId>');
    process.exit(1);
  }

  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  let sa: any;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    sa = JSON.parse(readFileSync(saPath, 'utf-8'));
  }

  const app = initializeApp({ credential: cert(sa) }, 'delete-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  // Delete entities
  const entities = await db.collection('entities').where('universeAddress', '==', universeId).get();
  for (const doc of entities.docs) {
    await doc.ref.delete();
  }
  console.log(`Deleted ${entities.size} entities`);

  // Delete supporting docs
  for (const col of ['universeCredits', 'privateSectionConfig']) {
    try {
      await db.collection(col).doc(universeId).delete();
      console.log(`Deleted ${col}`);
    } catch {}
  }

  // Delete credit transactions
  const txs = await db
    .collection('universeCreditTransactions')
    .where('universeId', '==', universeId)
    .get();
  for (const doc of txs.docs) {
    await doc.ref.delete();
  }
  console.log(`Deleted ${txs.size} credit transactions`);

  // Delete universe
  await db.collection('cinematicUniverses').doc(universeId).delete();
  console.log(`Deleted universe ${universeId}`);

  process.exit(0);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

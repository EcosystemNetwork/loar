/**
 * Audit all Fogline-related universe docs and their node counts.
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

const app = initializeApp({ credential: cert(serviceAccount) }, `audit-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

async function main() {
  // Find all universes mentioning fogline/fallout
  const snap = await db.collection('cinematicUniverses').get();
  const fogline = snap.docs.filter((d) => {
    const data = d.data();
    const name = (data.name || '').toLowerCase();
    return name.includes('fogline') || name.includes('fallout');
  });

  console.log(`\nFound ${fogline.length} Fogline/Fallout universe doc(s):\n`);

  for (const doc of fogline) {
    const data = doc.data();
    console.log(`  ID: ${doc.id}`);
    console.log(`    name: ${data.name}`);
    console.log(`    address: ${data.address}`);
    console.log(`    onChainUniverseId: ${data.onChainUniverseId || '(null/off-chain)'}`);
    console.log(`    chainId: ${data.chainId || '(none)'}`);
    console.log(`    creator: ${data.creator}`);
    console.log(
      `    created_at: ${data.created_at?.toDate?.()?.toISOString?.() || data.created_at || 'unknown'}`
    );

    // Count off-chain nodes
    const offChainNodes = await db
      .collection('offChainNodes')
      .where('universeId', '==', doc.id)
      .get();
    console.log(`    offChainNodes: ${offChainNodes.size}`);

    // Count entities
    const entities = await db.collection('entities').where('universeAddress', '==', doc.id).get();
    console.log(`    entities: ${entities.size}`);

    // Count video generations
    const vids = await db.collection('videoGenerations').where('universeId', '==', doc.id).get();
    console.log(`    videoGenerations: ${vids.size}`);
    console.log('');
  }

  // Also check for orphan offChainNodes
  console.log(`\nAll offChainNodes by universeId:`);
  const allNodes = await db.collection('offChainNodes').get();
  const byUniverse = new Map<string, number>();
  allNodes.docs.forEach((d) => {
    const uid = d.data().universeId;
    byUniverse.set(uid, (byUniverse.get(uid) || 0) + 1);
  });
  for (const [uid, count] of byUniverse) {
    console.log(`  ${uid}: ${count} nodes`);
  }
}

main().catch(console.error);

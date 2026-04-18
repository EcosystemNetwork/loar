/**
 * Search all Firestore collections for anything related to "Cyber War".
 *
 * Usage: pnpm tsx scripts/find-cyber-war.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

let serviceAccount: any;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  const absPath = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  serviceAccount = JSON.parse(readFileSync(absPath, 'utf-8'));
}
if (!serviceAccount) {
  console.error('No Firebase credentials.');
  process.exit(1);
}
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

async function main() {
  // List all top-level collections
  const collections = await db.listCollections();
  console.log('All Firestore collections:');
  for (const col of collections) {
    const snap = await col.limit(1).get();
    console.log(`  ${col.id} (${snap.size > 0 ? 'has docs' : 'empty'})`);
  }

  // Search each collection for "Cyber War" or "CYWAR" in any field
  console.log('\nSearching for "Cyber War" across all collections...\n');
  for (const col of collections) {
    const allDocs = await col.get();
    for (const doc of allDocs.docs) {
      const data = doc.data();
      const json = JSON.stringify(data).toLowerCase();
      if (
        json.includes('cyber war') ||
        json.includes('cywar') ||
        json.includes('cyber_war') ||
        json.includes('cyberwar')
      ) {
        console.log(`FOUND in ${col.id}/${doc.id}:`);
        // Print key fields, not the whole doc
        console.log(`  name: ${data.name ?? data.title ?? 'N/A'}`);
        console.log(`  kind: ${data.kind ?? 'N/A'}`);
        console.log(`  universeAddress: ${data.universeAddress ?? data.address ?? 'N/A'}`);
        console.log(`  created_at: ${data.created_at ?? data.createdAt ?? 'N/A'}`);
        console.log(`  creator: ${data.creator ?? data.creatorAddress ?? 'N/A'}`);
        console.log('');
      }
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

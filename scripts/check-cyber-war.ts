/**
 * Diagnose why "Cyber War" universe is missing from the listing.
 *
 * Checks:
 *   1. Does the document exist in 'cinematicUniverses'?
 *   2. Does it have a valid 'created_at' field? (required for orderBy query)
 *   3. What does getAllUniverses() actually return?
 *
 * Usage: pnpm tsx scripts/check-cyber-war.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Firebase init (same as server) ───────────────────────────────────────────
let serviceAccount: any;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  const absPath = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  serviceAccount = JSON.parse(readFileSync(absPath, 'utf-8'));
}
if (!serviceAccount) {
  console.error(
    'No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH.'
  );
  process.exit(1);
}

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

async function main() {
  const col = db.collection('cinematicUniverses');

  // 1. Find any doc with name "Cyber War"
  console.log('\n=== Searching for "Cyber War" by name ===');
  const byName = await col.where('name', '==', 'Cyber War').get();
  if (byName.empty) {
    console.log('NOT FOUND — no document with name "Cyber War" exists in Firestore.');
    console.log('The Firestore registration step likely failed when running create-cyber-war.ts.');
  } else {
    for (const doc of byName.docs) {
      const d = doc.data();
      console.log(`\nFound doc: ${doc.id}`);
      console.log(`  name:        ${d.name}`);
      console.log(
        `  created_at:  ${d.created_at} (type: ${typeof d.created_at}, isTimestamp: ${d.created_at?.toDate !== undefined})`
      );
      console.log(`  creator:     ${d.creator}`);
      console.log(`  address:     ${d.address}`);
      console.log(`  tokenAddr:   ${d.tokenAddress}`);
      console.log(`  image_url:   ${d.image_url?.slice(0, 80)}...`);
      console.log(`  accessModel: ${d.accessModel}`);
      console.log(`  chainId:     ${d.chainId}`);

      if (!d.created_at) {
        console.log(
          '\n  ⚠ PROBLEM: missing created_at — this doc is invisible to orderBy("created_at") queries!'
        );
      }
    }
  }

  // 2. List ALL docs (no orderBy) to see everything
  console.log('\n=== All documents in cinematicUniverses (no orderBy) ===');
  const all = await col.get();
  console.log(`Total documents: ${all.size}`);
  for (const doc of all.docs) {
    const d = doc.data();
    const ca = d.created_at?.toDate?.() ?? d.created_at ?? 'MISSING';
    console.log(`  ${doc.id} — "${d.name}" — created_at: ${ca}`);
  }

  // 3. Simulate the actual getAll query
  console.log('\n=== Simulating getAllUniverses() — orderBy("created_at").limit(500) ===');
  const ordered = await col.orderBy('created_at').limit(500).get();
  console.log(`Returned: ${ordered.size} documents`);
  const names = ordered.docs.map((d) => `"${d.data().name}"`);
  console.log(`Names: ${names.join(', ')}`);

  const hasCyberWar = ordered.docs.some((d) => d.data().name === 'Cyber War');
  console.log(`\nCyber War in results: ${hasCyberWar ? 'YES ✓' : 'NO ✗'}`);

  if (!hasCyberWar && !byName.empty) {
    console.log('\nDIAGNOSIS: Document exists but is excluded from orderBy query.');
    console.log('Fix: add/repair the created_at field. Run with --fix flag to auto-repair.');

    if (process.argv.includes('--fix')) {
      for (const doc of byName.docs) {
        const d = doc.data();
        if (!d.created_at) {
          console.log(`\nFixing ${doc.id}: setting created_at to now...`);
          await col.doc(doc.id).update({ created_at: new Date(), updated_at: new Date() });
          console.log('Done ✓');
        }
      }
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

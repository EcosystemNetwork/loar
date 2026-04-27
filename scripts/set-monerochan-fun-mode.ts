/**
 * Flip the Monerochan universe to fun-mode so the watch page reads its
 * Firestore offChainNodes (the actual home of its 40 clips) instead of
 * Ponder, which has nothing for the synthetic address. Idempotent.
 *
 *   pnpm tsx scripts/set-monerochan-fun-mode.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9e1c8a49';

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, 'mc-fun-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const ref = db.collection('cinematicUniverses').doc(UNIVERSE_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error('Universe doc not found:', UNIVERSE_ID);
    process.exit(1);
  }
  const x = snap.data() as any;
  console.log(`Before: name="${x.name}" universeType="${x.universeType ?? '(undefined)'}"`);

  if (x.universeType === 'fun') {
    console.log('Already fun-mode — nothing to do.');
    process.exit(0);
  }

  await ref.update({ universeType: 'fun', updated_at: new Date() });
  const after = (await ref.get()).data() as any;
  console.log(`After:  name="${after.name}" universeType="${after.universeType}"`);

  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

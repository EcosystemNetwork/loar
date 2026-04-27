/**
 * Tag the two Monerochan episodes with their visual style so the watch page
 * surfaces them with a chip + groups animated above realistic. Idempotent.
 *
 *   pnpm tsx scripts/tag-monerochan-episode-styles.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9e1c8a49';

const ASSIGNMENTS: Array<{ id: string; style: 'animated' | 'realistic' }> = [
  { id: '01b09a04-c0c5-4d0b-9506-d2f1485e8a46', style: 'animated' },
  { id: 'f8000092-2800-42a2-948f-33466f5df683', style: 'realistic' },
];

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, 'mc-style-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  for (const a of ASSIGNMENTS) {
    const ref = db.collection('episodes').doc(a.id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`SKIP ${a.id} — not found`);
      continue;
    }
    const x = snap.data() as any;
    if (x.universeId !== UNIVERSE_ID) {
      console.log(`SKIP ${a.id} — wrong universe (${x.universeId})`);
      continue;
    }
    if (x.style === a.style) {
      console.log(`OK   ${a.id} — already style="${a.style}" ("${x.title}")`);
      continue;
    }
    await ref.update({ style: a.style, updatedAt: new Date() });
    console.log(`SET  ${a.id} — style="${a.style}" ("${x.title}")`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

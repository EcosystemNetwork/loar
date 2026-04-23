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

  const snap = await db.collection('cinematicUniverses').get();
  console.log('\nAll universes with isHidden or isPrivate:\n');

  for (const doc of snap.docs) {
    const d = doc.data() as any;
    const hidden = d.isHidden === true;
    const priv = d.isPrivate === true;
    if (!hidden && !priv) continue;
    const addr = (d.address || doc.id || '').toLowerCase();
    const contentCount = (
      await db.collection('content').where('universeId', '==', addr).count().get()
    ).data().count;

    console.log(
      `${(d.name || '(no name)').padEnd(32)} addr=${addr.slice(0, 10)}… isHidden=${hidden} isPrivate=${priv} content=${contentCount}`
    );
    if (d.hiddenReason) console.log(`    reason: ${d.hiddenReason}`);
    if (d.hiddenBy) console.log(`    by: ${d.hiddenBy}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

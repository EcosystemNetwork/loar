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
  console.log(`total: ${snap.size}`);
  console.log();

  for (const doc of snap.docs) {
    const d = doc.data() as any;
    const name = d.name || '(no name)';
    const addr = (d.address || doc.id || '').slice(0, 10);
    const creator = (d.creator || '').slice(0, 10);
    const hasCore = !!d.tokenAddress || !!d.governanceAddress;
    const hasMint = !!d.mintTxHash;
    const hasImg = !!(d.image_url || d.imageUrl);
    const created = d.created_at?.toDate?.()?.toISOString?.()?.slice(0, 10) || '?';

    // Count content for this universe
    const contentCount = (
      await db
        .collection('content')
        .where('universeId', '==', (d.address || doc.id || '').toLowerCase())
        .count()
        .get()
    ).data().count;

    console.log(
      `${name.padEnd(32)} addr=${addr}… creator=${creator}… core=${hasCore ? 'y' : 'n'} mint=${hasMint ? 'y' : 'n'} img=${hasImg ? 'y' : 'n'} created=${created} content=${contentCount}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

/**
 * Unhide the 3 content-rich staging universes so their episodes surface on
 * the landing page / video gallery. Matched by name (case-insensitive) among
 * currently-hidden docs — avoids accidentally un-hiding a random record.
 *
 * Usage:
 *   pnpm tsx scripts/unhide-staging-universes.ts              # dry run
 *   pnpm tsx scripts/unhide-staging-universes.ts --apply
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');

const TARGET_NAMES = ['dostopia: the iron faith', 'monerochan: untraceable', 'fallout: fogline'];

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
  const app = getApps()[0] || initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const snap = await db.collection('cinematicUniverses').where('isHidden', '==', true).get();

  console.log(`\n${snap.size} currently-hidden universes scanned`);
  let matches = 0;

  for (const doc of snap.docs) {
    const d = doc.data() as any;
    const name = (d.name || '').trim().toLowerCase();
    if (!TARGET_NAMES.includes(name)) continue;
    matches++;
    console.log(`  ${d.name}  (addr=${(d.address || doc.id).slice(0, 12)}…)  → UNHIDE`);
    if (APPLY) {
      await doc.ref.update({
        isHidden: false,
        unhiddenAt: new Date().toISOString(),
        unhiddenBy: 'backfill:unhide-staging',
        unhiddenReason: 'content-rich staging universe brought back to public showcase',
      });
    }
  }

  if (matches !== TARGET_NAMES.length) {
    console.log(
      `\n⚠ matched ${matches}/${TARGET_NAMES.length} targets — check names against Firestore`
    );
  }
  console.log('✓ done');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

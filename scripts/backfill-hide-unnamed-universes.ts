/**
 * Hide unnamed placeholder universes from public listings.
 *
 * Dev/test flows that abort after `universes.create` leave behind Firestore
 * docs with `address: 0x0000...`, no `name`, no on-chain `mintTxHash`, and
 * zero content. They clutter admin dashboards and risk surfacing as empty
 * cards if anything calls `getAll({ includeHidden: true })`.
 *
 * This script sets `isHidden: true` (and a reason) on every such doc so
 * `getAllUniverses()` (which filters `!isHidden` by default) excludes them.
 * Does NOT delete — the records stay for audit.
 *
 * Criteria: empty name AND no content AND (zero-address OR no mintTxHash).
 *
 * Usage:
 *   pnpm tsx scripts/backfill-hide-unnamed-universes.ts              # dry run
 *   pnpm tsx scripts/backfill-hide-unnamed-universes.ts --apply
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');

function isZeroAddress(addr?: string | null): boolean {
  if (!addr) return true;
  return /^0x0{20,}/i.test(addr);
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
  const app = getApps()[0] || initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const snap = await db.collection('cinematicUniverses').get();
  console.log(`\nscanning ${snap.size} universe docs...`);

  const counts = { hide: 0, keep: 0, alreadyHidden: 0 };

  for (const doc of snap.docs) {
    const d = doc.data() as any;
    const name = (d.name || '').trim();
    const addr = (d.address || doc.id || '').toLowerCase();
    const hasName = name.length > 0;
    const hasMint = !!d.mintTxHash;
    const alreadyHidden = d.isHidden === true;

    const contentCount = (
      await db.collection('content').where('universeId', '==', addr).count().get()
    ).data().count;

    const qualifiesAsGarbage = !hasName && contentCount === 0 && (isZeroAddress(addr) || !hasMint);

    if (alreadyHidden) {
      counts.alreadyHidden++;
      continue;
    }
    if (!qualifiesAsGarbage) {
      counts.keep++;
      continue;
    }

    counts.hide++;
    console.log(
      `  ${doc.id.slice(0, 12)}… name="${name || '(empty)'}" content=${contentCount} mint=${hasMint ? 'y' : 'n'} → HIDE`
    );
    if (APPLY) {
      await doc.ref.update({
        isHidden: true,
        hiddenReason: 'no name + no content + not minted on-chain',
        hiddenAt: new Date().toISOString(),
        hiddenBy: 'backfill:unnamed-universes',
      });
    }
  }

  console.log('\nsummary:', counts);
  console.log('✓ done');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

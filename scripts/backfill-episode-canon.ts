/**
 * Backfill isCanon = true on legacy episodes.
 *
 * Episodes created before Phase 1 of the canon/draft flow have no `isCanon`
 * field. The new `episodes.list` filter treats a missing field as non-canon,
 * so legacy episodes would vanish from public listings.
 *
 * Legacy behaviour was "all episodes are public," so we backfill them as
 * canon to preserve visibility. Draft-until-published only applies to
 * episodes created after this script runs.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-episode-canon.ts            # audit (dry-run)
 *   pnpm tsx scripts/backfill-episode-canon.ts --apply    # write
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');

const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));
const app = initializeApp({ credential: cert(serviceAccount) }, `backfill-canon-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

async function main() {
  console.log(`[backfill-episode-canon] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const snap = await db.collection('episodes').get();
  console.log(`[backfill-episode-canon] scanning ${snap.size} episode docs`);

  const now = new Date().toISOString();
  let needsBackfill = 0;
  let alreadyCanon = 0;
  let alreadyDraft = 0;

  // Firestore batch limit is 500 writes.
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (typeof data.isCanon === 'boolean') {
      if (data.isCanon) alreadyCanon++;
      else alreadyDraft++;
      continue;
    }

    needsBackfill++;
    if (!APPLY) continue;

    batch.update(doc.ref, {
      isCanon: true,
      canonizedAt: now,
      canonTipNodeId: null,
      canonTxHash: null,
      canonBackfilled: true,
    });
    pending++;

    if (pending >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (APPLY && pending > 0) {
    await batch.commit();
  }

  console.log(`
Results
  legacy episodes backfilled: ${needsBackfill}${APPLY ? ' (written)' : ' (dry-run)'}
  already canon:              ${alreadyCanon}
  already draft:              ${alreadyDraft}
  total:                      ${snap.size}
`);

  if (!APPLY && needsBackfill > 0) {
    console.log('Re-run with --apply to write.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-episode-canon] failed:', err);
    process.exit(1);
  });

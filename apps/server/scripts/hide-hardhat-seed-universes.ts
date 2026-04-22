/**
 * Hide Hardhat-seeded placeholder universe docs in prod Firestore.
 *
 * Symptom: 14 `cinematicUniverses` docs sort to the top of the landing page
 * because `getAllUniverses()` orders by `created_at` ascending. They have:
 *   - id starting with "0x0000000000000000"
 *   - creator = Hardhat account #0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)
 *   - name = null, onChainUniverseId = null
 *   - image_url = https://ipfs.io/ipfs/QmUNLL…/readme.txt (404, not an image)
 *
 * Fix: flip `isHidden = true` via `setUniverseHidden` so they drop out of
 * every listing endpoint but the docs stay recoverable. Writes a
 * `contentAuditLog` entry per doc (reason captured via `actor.reason`).
 *
 * Usage:
 *   DRY_RUN=1 pnpm -F server tsx scripts/hide-hardhat-seed-universes.ts
 *   pnpm -F server tsx scripts/hide-hardhat-seed-universes.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const HARDHAT_CREATOR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const ZERO_PREFIX = '0x0000000000000000';
const JUNK_IMAGE_PREFIX = 'https://ipfs.io/ipfs/QmUNLL';

async function main() {
  const isDryRun = process.env.DRY_RUN === '1';

  const firebase = await import('../src/lib/firebase.js');
  if ('initFirebase' in firebase && typeof firebase.initFirebase === 'function') {
    firebase.initFirebase();
  }
  const { db } = firebase;
  const { setUniverseHidden } = await import('../src/routers/universes/universes.handlers.js');

  if (!db) throw new Error('Firestore not configured — check FIREBASE_* env vars.');

  const snapshot = await db.collection('cinematicUniverses').get();

  const seedCandidates: { id: string; creator?: string; image_url?: string; isHidden?: boolean }[] =
    [];
  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const id = doc.id;
    const creator = ((data.creator as string | undefined) ?? '').toLowerCase();
    const imageUrl = (data.image_url as string | undefined) ?? '';
    const looksLikeSeed =
      (id.startsWith(ZERO_PREFIX) && creator === HARDHAT_CREATOR) ||
      imageUrl.startsWith(JUNK_IMAGE_PREFIX);
    if (looksLikeSeed) {
      seedCandidates.push({
        id,
        creator,
        image_url: imageUrl,
        isHidden: Boolean(data.isHidden),
      });
    }
  }

  console.log(`Found ${seedCandidates.length} seed/junk universe docs.`);
  for (const c of seedCandidates) {
    console.log(
      `  ${c.id} creator=${c.creator} already_hidden=${c.isHidden} image=${(c.image_url || '').slice(0, 60)}`
    );
  }

  if (seedCandidates.length === 0) {
    console.log('Nothing to hide.');
    return;
  }

  if (isDryRun) {
    console.log('\nDRY_RUN=1 — no writes performed.');
    return;
  }

  let hidden = 0;
  let skipped = 0;
  for (const c of seedCandidates) {
    if (c.isHidden) {
      skipped++;
      continue;
    }
    await setUniverseHidden(c.id, true, {
      uid: 'script:hide-hardhat-seed-universes',
      address: HARDHAT_CREATOR,
    });
    hidden++;
    console.log(`  hid ${c.id}`);
  }
  console.log(`\nDone. hidden=${hidden} already_hidden=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

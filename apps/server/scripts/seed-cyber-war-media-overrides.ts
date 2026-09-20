/**
 * Fixture seed for the real-stack test
 * apps/web/src/hooks/__tests__/universeCanvasNodesOnScreen.test.tsx.
 *
 * Writes the real "Cyber War" universe's (0x341ffa19c0ec8d2c8ef42a360cf799949844262e)
 * nodeMediaOverrides into a locally-running Firestore emulator — the exact
 * 102-of-116-hidden-nodes state captured from production on 2026-09-19
 * (originally set by scripts/hide-cyber-war-broken.ts on 2026-04-22), so the
 * real-stack test reproduces the actual reported "nodes pop up and
 * disappear" incident against real data instead of a synthetic fixture.
 *
 * Usage (against a locally running emulator only — never targets prod):
 *   firebase emulators:start --only firestore --project loar-db &
 *   pnpm -F server exec tsx scripts/seed-cyber-war-media-overrides.ts
 */
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ??= 'loar-db';

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST must be set — this script only targets the emulator.');
}

if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = getFirestore();

const UNIVERSE_ADDR = '0x341ffa19c0ec8d2c8ef42a360cf799949844262e';
const TOTAL_NODES = 116;
// The 14 nodes production currently leaves visible; every other id in
// [1, TOTAL_NODES] gets a `hidden: true` override, matching the real state.
const VISIBLE = new Set([21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]);

async function main() {
  const batch = db.batch();
  let n = 0;
  for (let id = 1; id <= TOTAL_NODES; id++) {
    if (VISIBLE.has(id)) continue;
    const ref = db.collection('nodeMediaOverrides').doc(`${UNIVERSE_ADDR}:${id}`);
    batch.set(ref, {
      universeAddress: UNIVERSE_ADDR,
      nodeId: id,
      hidden: true,
      reason:
        id <= 20
          ? 'Placeholder URL (ep-N-placeholder.mp4) — content never uploaded'
          : 'Expired ByteDance presigned URL (~24h TTL) — original video not recoverable',
      updatedBy: 'script:hide-cyber-war-broken',
      updatedAt: new Date('2026-04-22T12:31:23.000Z'),
    });
    n++;
  }
  await batch.commit();
  console.log(`seeded ${n} hidden nodeMediaOverrides for ${UNIVERSE_ADDR}`);

  const check = await db
    .collection('nodeMediaOverrides')
    .where('universeAddress', '==', UNIVERSE_ADDR)
    .get();
  console.log('verify count in emulator:', check.size);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

/**
 * Hide Cyber War nodes whose on-chain videoLink points at dead content.
 *
 * Writes `nodeMediaOverrides` records with `hidden: true` for every node whose
 * event-emitted `link` is either a 404 placeholder or an expired ByteDance
 * presigned URL. Hidden nodes are filtered out by the universe page without
 * touching on-chain state.
 *
 * Audit: derived by querying the Ponder indexer `nodeContents` table for
 * universe 0x341fFa19c0EC8D2C8eF42A360cf799949844262e — 116 nodes total,
 * 14 pinned to Pinata (#21–34, kept), 20 placeholder (#1–20, hidden),
 * 82 ByteDance presigned (#35–116, hidden).
 *
 * Usage:
 *   pnpm tsx scripts/hide-cyber-war-broken.ts           # dry run
 *   pnpm tsx scripts/hide-cyber-war-broken.ts --apply   # write records
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE = '0x341ffa19c0ec8d2c8ef42a360cf799949844262e';
const APPLY = process.argv.includes('--apply');

const PLACEHOLDER_IDS = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
const BYTEDANCE_IDS = Array.from({ length: 82 }, (_, i) => i + 35); // 35..116
const HIDE_IDS = [...PLACEHOLDER_IDS, ...BYTEDANCE_IDS];

const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
);
const sa = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));
const app = initializeApp({ credential: cert(sa) }, `hide-cw-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

async function main() {
  console.log(APPLY ? 'APPLY MODE — writing records' : 'DRY RUN (pass --apply to write)');
  console.log(`Universe: ${UNIVERSE}`);
  console.log(
    `Hiding ${HIDE_IDS.length} nodes (${PLACEHOLDER_IDS.length} placeholder + ${BYTEDANCE_IDS.length} ByteDance)`
  );

  if (!APPLY) {
    console.log('\nWould write nodeMediaOverrides docs:');
    console.log(`  placeholder ids: ${PLACEHOLDER_IDS.join(', ')}`);
    console.log(
      `  ByteDance ids:   ${BYTEDANCE_IDS[0]}..${BYTEDANCE_IDS[BYTEDANCE_IDS.length - 1]}`
    );
    process.exit(0);
  }

  const col = db.collection('nodeMediaOverrides');
  const now = new Date();
  let written = 0;

  for (let i = 0; i < HIDE_IDS.length; i += 400) {
    const chunk = HIDE_IDS.slice(i, i + 400);
    const batch = db.batch();
    for (const nodeId of chunk) {
      const reason = PLACEHOLDER_IDS.includes(nodeId)
        ? 'Placeholder URL (ep-N-placeholder.mp4) — content never uploaded'
        : 'Expired ByteDance presigned URL (~24h TTL) — original video not recoverable';
      const ref = col.doc(`${UNIVERSE}:${nodeId}`);
      batch.set(
        ref,
        {
          universeAddress: UNIVERSE,
          nodeId,
          hidden: true,
          reason,
          updatedAt: now,
          updatedBy: 'script:hide-cyber-war-broken',
        },
        { merge: true }
      );
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  committed ${written}/${HIDE_IDS.length}`);
  }

  console.log(`\nDone. Wrote ${written} hidden overrides.`);
  console.log('Visible nodeIds remaining: 21..34 (14 nodes with Pinata-pinned videos).');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

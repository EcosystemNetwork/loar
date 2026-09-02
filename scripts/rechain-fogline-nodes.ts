/**
 * Re-chain Fogline's off-chain timeline nodes into a single sequential timeline.
 *
 * All 61 `offChainNodes` docs for Fogline carry `rebuiltReason:
 * '2026-04-27-cull-restore'` — a prior cull-restore recreated them from
 * videoGenerations records but flat-inserted each with the create-time
 * default `previousNodeId: 0`, so every node looks like an unlinked root
 * with empty `children`. The editor's timeline canvas walks previousNodeId/
 * children to build its graph, so a chain of 61 disconnected roots renders
 * as effectively nothing coherent.
 *
 * `createdAt` order matches `nodeId` order exactly (86..146, verified against
 * a live production read on 2026-08-23), so this just links each node to the
 * next by nodeId: node[i+1].previousNodeId = node[i].nodeId, and appends
 * node[i+1].nodeId to node[i].children. The first node (lowest nodeId) stays
 * the true root (previousNodeId: 0). `canon` is left untouched — all 61 were
 * already `canon: true`, which is correct for a single linear canonical
 * timeline once actually connected.
 *
 * Usage:
 *   pnpm tsx scripts/rechain-fogline-nodes.ts              # dry run
 *   pnpm tsx scripts/rechain-fogline-nodes.ts --apply
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const UNIVERSE_ID = '0x0000000000000000000000000000019d9e26795c';

const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));

const app = initializeApp({ credential: cert(serviceAccount) }, `rechain-fogline-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

async function main() {
  const snap = await db
    .collection('offChainNodes')
    .where('universeId', '==', UNIVERSE_ID)
    .orderBy('nodeId', 'asc')
    .get();

  const docs = snap.docs;
  console.log(
    `Found ${docs.length} offChainNodes for Fogline (nodeId ${docs[0]?.data().nodeId}..${docs[docs.length - 1]?.data().nodeId})\n`
  );

  // Sanity: every node currently a disconnected root. If that's no longer
  // true (e.g. this was already partially repaired), abort rather than
  // clobber real structure.
  const nonRootAlready = docs.filter((d) => (d.data().previousNodeId || 0) !== 0);
  if (nonRootAlready.length > 0) {
    console.error(
      `ABORT: ${nonRootAlready.length} node(s) already have a non-zero previousNodeId — ` +
        `chain may already be partially built. Refusing to run blindly.`
    );
    console.error(nonRootAlready.map((d) => d.data().nodeId).join(', '));
    process.exit(1);
  }

  const plan: Array<{ id: string; nodeId: number; previousNodeId: number; addChild?: number }> = [];
  for (let i = 0; i < docs.length; i++) {
    const nodeId = docs[i].data().nodeId as number;
    if (i === 0) {
      plan.push({ id: docs[i].id, nodeId, previousNodeId: 0 }); // stays root
      continue;
    }
    const prevNodeId = docs[i - 1].data().nodeId as number;
    plan.push({ id: docs[i].id, nodeId, previousNodeId: prevNodeId });
  }

  console.log('Planned chain (nodeId <- previousNodeId):');
  for (const p of plan) {
    console.log(
      `  ${p.nodeId}${p.previousNodeId ? ` <- ${p.previousNodeId}` : ' (root, unchanged)'}`
    );
  }

  if (!APPLY) {
    console.log('\n(DRY RUN — no writes performed. Re-run with --apply to write.)');
    return;
  }

  console.log('\nApplying...');
  const batchSize = 400; // stay under Firestore's 500-write batch cap
  for (let start = 0; start < docs.length; start += batchSize) {
    const batch = db.batch();
    const chunk = docs.slice(start, start + batchSize);
    for (let j = 0; j < chunk.length; j++) {
      const globalIdx = start + j;
      if (globalIdx === 0) continue; // root stays as-is
      const doc = chunk[j];
      const prevDoc = docs[globalIdx - 1];
      const prevNodeId = prevDoc.data().nodeId as number;

      batch.update(doc.ref, { previousNodeId: prevNodeId, updatedAt: new Date() });

      const prevChildren = (prevDoc.data().children || []) as number[];
      const nodeId = doc.data().nodeId as number;
      if (!prevChildren.includes(nodeId)) {
        batch.update(prevDoc.ref, {
          children: [...prevChildren, nodeId],
          updatedAt: new Date(),
        });
      }
    }
    await batch.commit();
    console.log(`  committed batch [${start}, ${Math.min(start + batchSize, docs.length)})`);
  }

  console.log(`\nDone. ${docs.length - 1} link(s) written.`);
}

main().catch((err) => {
  console.error('RECHAIN FAILED:', err);
  process.exit(1);
});

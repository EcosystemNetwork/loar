/**
 * Repair duplicate `nodeId`s in `offChainNodes`.
 *
 * Two docs sharing (universeId, nodeId) collapse into one node on the timeline
 * canvas (the tree layout and React Flow both key on nodeId). Cause: the
 * per-universe counter lagged the real maximum (direct-writing scripts, or a
 * counter keyed by a pre-normalisation universe id) so `create` re-issued an
 * id. `create` now self-heals (max(counter, highest existing) + 1); this
 * script fixes the rows already damaged.
 *
 * For each duplicated (universeId, nodeId) the KEEPER is the doc created
 * through the router (doc id === its `id` field); other docs are legacy
 * hero-scene / migrated rows (doc id "<universe>:<n>"). If none qualifies the
 * oldest keeps the id. Every other doc is renumbered to max+1 and becomes a
 * standalone root (previousNodeId 0, children []). Children the old
 * `appendChild` (findNode(...).limit(1)) attached to the wrong doc are handed
 * to the keeper, since their previousNodeId points at the shared id. Finally
 * the universe's counter is set to max(nodeId).
 *
 * Usage (dry run is the default — prints the plan, writes nothing):
 *   pnpm tsx scripts/repair-duplicate-offchain-node-ids.ts
 *   pnpm tsx scripts/repair-duplicate-offchain-node-ids.ts --apply
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT_PATH  (default: ~/.config/loar/loar-db-sa.json)
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';
import os from 'os';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const saPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(os.homedir(), '.config/loar/loar-db-sa.json');
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) });
const db = getFirestore();

const millis = (v: any): number =>
  v?.toMillis?.() ?? (v instanceof Date ? v.getTime() : Number(v) || 0);

async function main() {
  const snap = await db.collection('offChainNodes').get();
  const byUniverse = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const d of snap.docs) {
    const u = d.data().universeId as string;
    if (!byUniverse.has(u)) byUniverse.set(u, []);
    byUniverse.get(u)!.push(d);
  }

  let repaired = 0;
  for (const [universeId, docs] of byUniverse) {
    const groups = new Map<number, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const d of docs) {
      const id = d.data().nodeId as number;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(d);
    }
    const dupes = [...groups.entries()].filter(([, g]) => g.length > 1);
    if (dupes.length === 0) continue;

    let max = Math.max(...docs.map((d) => d.data().nodeId as number));
    console.log(`\n${universeId}: ${docs.length} nodes, max nodeId ${max}`);
    const batch = db.batch();

    for (const [nodeId, group] of dupes) {
      const routerMade = (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data().id === d.id;
      group.sort(
        (a, b) =>
          Number(routerMade(b)) - Number(routerMade(a)) ||
          millis(a.data().createdAt) - millis(b.data().createdAt)
      );
      const [keep, ...rest] = group;
      console.log(
        `  nodeId ${nodeId} x${group.length}; keeping ${keep.id} (${keep.data().title || keep.data().label || '-'})`
      );
      for (const d of rest) {
        const newId = ++max;
        const kids = (d.data().children as number[] | undefined) ?? [];
        console.log(
          `    ${d.id} (${d.data().label || d.data().title || '-'}) -> nodeId ${newId}; standalone root; children ${JSON.stringify(kids)} -> keeper`
        );
        batch.update(d.ref, {
          nodeId: newId,
          previousNodeId: 0,
          children: [],
          updatedAt: new Date(),
        });
        if (kids.length) batch.update(keep.ref, { children: FieldValue.arrayUnion(...kids) });
      }
    }
    batch.set(
      db.collection('offChainNodeCounters').doc(universeId),
      { latest: max, updatedAt: new Date() },
      { merge: true }
    );
    if (APPLY) await batch.commit();
    repaired++;
  }
  console.log(
    `\n${repaired} universe(s) with duplicates. ${APPLY ? 'APPLIED.' : 'Dry run — re-run with --apply.'}`
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);

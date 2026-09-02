/**
 * Repair the existing `offChainNodes` docs for the "Nexus Protocol" universe.
 *
 * Found via inspection (29 docs, counter.latest=47):
 *   1. Every videoUrl still points at the dead private Pinata gateway
 *      (peach-impressive-moth-978.mypinata.cloud) — same root cause
 *      fix-nexus-protocol-dead-gateway-urls.ts already fixed for
 *      content/episodes/entities/cinematicUniverses, but that script never
 *      touched offChainNodes.
 *   2. The chain has gaps: nodeIds 11-23, 25, 32-33, 36-37 don't exist
 *      (their generations presumably failed while the counter still
 *      advanced), leaving surviving nodes pointing at previousNodeId/
 *      children values that reference nothing. Surviving nodeIds in order:
 *      1..10, 24, 26..31, 34, 35.
 *   3. nodeIds 38-47 are 10 disconnected duplicate roots (previousNodeId=0,
 *      children=[]) whose content duplicates nodes 1-10 — leftovers from a
 *      failed/retried generation run, not real additional story content.
 *
 * This script:
 *   - Rewrites every offChainNodes videoUrl on the dead gateway host to the
 *     public gateway (archiving the old URL, same convention as
 *     fix-nexus-protocol-dead-gateway-urls.ts).
 *   - Relinks the surviving chain nodes (1..10, 24, 26..31, 34, 35) into one
 *     continuous previousNodeId/children chain, closing the gaps. nodeId
 *     values themselves are NOT renumbered — only the previousNodeId/
 *     children pointers change.
 *   - Deletes the 10 disconnected duplicate-root docs (nodeIds 38-47).
 *
 * Usage:
 *   pnpm tsx scripts/repair-nexus-protocol-offchain-nodes.ts --dry-run
 *   pnpm tsx scripts/repair-nexus-protocol-offchain-nodes.ts
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT_PATH  (default: ~/.config/loar/loar-db-sa.json)
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const UNIVERSE_ID = '0x0000000000000000000000000000019d9ab4ae0f';
const DEAD_HOST = 'peach-impressive-moth-978.mypinata.cloud';
const PUBLIC_GATEWAY = 'https://gateway.pinata.cloud';
const DUPLICATE_ORPHAN_NODE_IDS = new Set([38, 39, 40, 41, 42, 43, 44, 45, 46, 47]);
const DRY_RUN = process.argv.includes('--dry-run');

function rewriteUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.host !== DEAD_HOST) return null;
    return `${PUBLIC_GATEWAY}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

async function main() {
  const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  let app;
  if (usingEmulator) {
    app = initializeApp(
      { projectId: process.env.GCLOUD_PROJECT || 'loar-db' },
      `nexus-repair-${Date.now()}`
    );
  } else {
    const saPath = path.resolve(
      process.cwd(),
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ??
        `${process.env.HOME}/.config/loar/loar-db-sa.json`
    );
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
    app = initializeApp({ credential: cert(sa) }, `nexus-repair-${Date.now()}`);
  }
  const db: Firestore = getFirestore(app);
  db.settings({ preferRest: true });

  console.log(`\n=== Nexus Protocol offChainNodes repair (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);
  console.log(
    `Firestore target: ${usingEmulator ? process.env.FIRESTORE_EMULATOR_HOST + ' (emulator)' : 'PRODUCTION'} (project ${app.options.projectId})\n`
  );

  const snap = await db
    .collection('offChainNodes')
    .where('universeId', '==', UNIVERSE_ID)
    .orderBy('nodeId', 'asc')
    .get();

  const docs = snap.docs.map((d) => ({ ref: d.ref, id: d.id, data: d.data() as any }));
  console.log(`Loaded ${docs.length} docs.\n`);

  // ── 1. Dead-gateway URL rewrites ────────────────────────────────────────
  const urlFixes: { id: string; nodeId: number; oldUrl: string; newUrl: string }[] = [];
  for (const d of docs) {
    const nu = d.data.videoUrl ? rewriteUrl(d.data.videoUrl) : null;
    if (nu) urlFixes.push({ id: d.id, nodeId: d.data.nodeId, oldUrl: d.data.videoUrl, newUrl: nu });
  }
  console.log(`URL rewrites: ${urlFixes.length}/${docs.length} docs on the dead gateway.`);

  // ── 2. Chain relinking (drop the 10 duplicate orphan roots first) ──────
  const chainDocs = docs
    .filter((d) => !DUPLICATE_ORPHAN_NODE_IDS.has(d.data.nodeId))
    .sort((a, b) => a.data.nodeId - b.data.nodeId);
  const orphanDocs = docs.filter((d) => DUPLICATE_ORPHAN_NODE_IDS.has(d.data.nodeId));

  console.log(`\nSurviving chain (${chainDocs.length} nodes, in order):`);
  console.log('  ' + chainDocs.map((d) => d.data.nodeId).join(' -> '));
  console.log(`\nDuplicate orphan roots to delete (${orphanDocs.length}):`);
  console.log('  ' + orphanDocs.map((d) => d.data.nodeId).join(', '));

  const relinks: { id: string; nodeId: number; previousNodeId: number; children: number[] }[] = [];
  for (let i = 0; i < chainDocs.length; i++) {
    const cur = chainDocs[i];
    const prevNodeId = i === 0 ? 0 : chainDocs[i - 1].data.nodeId;
    const nextNodeId = i < chainDocs.length - 1 ? [chainDocs[i + 1].data.nodeId] : [];
    const needsFix =
      cur.data.previousNodeId !== prevNodeId ||
      JSON.stringify(cur.data.children || []) !== JSON.stringify(nextNodeId);
    if (needsFix) {
      relinks.push({
        id: cur.id,
        nodeId: cur.data.nodeId,
        previousNodeId: prevNodeId,
        children: nextNodeId,
      });
    }
  }
  console.log(`\nRelinks needed: ${relinks.length}/${chainDocs.length} nodes.`);
  for (const r of relinks) {
    console.log(
      `  node ${r.nodeId}: previousNodeId -> ${r.previousNodeId}, children -> [${r.children.join(',')}]`
    );
  }

  if (DRY_RUN) {
    console.log('\n(DRY_RUN — no writes performed.)');
    process.exit(0);
  }

  // Backup manifest before writing anything.
  const backupPath = path.resolve(
    process.cwd(),
    `repair-nexus-protocol-offchain-nodes-${Date.now()}.json`
  );
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ before: docs.map((d) => ({ id: d.id, data: d.data })) }, null, 2)
  );
  console.log(`\nBackup manifest written: ${backupPath}`);

  const now = new Date();

  console.log(`\nApplying ${urlFixes.length} URL fix(es)...`);
  for (const fix of urlFixes) {
    const d = docs.find((x) => x.id === fix.id)!;
    await d.ref.update({
      videoUrl: fix.newUrl,
      videoUrlArchived: fix.oldUrl,
      mediaUrlRepairedAt: now,
      mediaUrlRepairedReason: 'dead_dedicated_pinata_gateway_401_rewritten_to_public',
    });
  }

  console.log(`Applying ${relinks.length} relink(s)...`);
  for (const r of relinks) {
    await db
      .collection('offChainNodes')
      .doc(r.id)
      .update({ previousNodeId: r.previousNodeId, children: r.children, updatedAt: now });
  }

  console.log(`Deleting ${orphanDocs.length} duplicate orphan root(s)...`);
  for (const o of orphanDocs) {
    await o.ref.delete();
  }

  console.log(
    `\nDone. ${urlFixes.length} URL fixes, ${relinks.length} relinks, ${orphanDocs.length} deletions.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('REPAIR FAILED:', err);
  process.exit(1);
});

/**
 * Move timeline nodes that were mis-filed under Fallout: Fogline back to the
 * universes they belong to.
 *
 * The 2026-04-27 cull-restore recreated `offChainNodes` from `videoGenerations`
 * without separating universes, so Fogline ended up holding 25 scenes that are
 * really Dostopia: The Iron Faith (23) and Dragon Egg (2). Fogline's own 36
 * nodes are untouched apart from being re-chained.
 *
 *  - Dostopia scenes  -> universeId flipped to Dostopia (same doc id + nodeId;
 *    nodeIds are per-universe and 86..140 don't collide with Dostopia's 57..62).
 *  - Dragon Egg scenes -> the target universe already holds both "Ember Cradle"
 *    nodes, so the Fogline copies are deleted rather than duplicated.
 *  - videoGenerations tagged with Fogline but belonging elsewhere are retagged
 *    by `episodeTitle`.
 *  - Wiki Gallery clips (`content` collection, what gallery.browse serves) get
 *    the same treatment: "First Proof — …" videos -> Dostopia; "Ember Cradle"
 *    videos are deleted because Dragon Egg's wiki already has them.
 *  - Fogline + Dostopia are re-chained sequentially by nodeId (same rule as
 *    rechain-fogline-nodes.ts). Order is creation order, not story order.
 *
 * Every touched doc is backed up to ~/.config/loar/media-repair-backups/ first.
 *
 * Usage:
 *   pnpm tsx scripts/move-misplaced-fogline-nodes.ts            # dry run
 *   pnpm tsx scripts/move-misplaced-fogline-nodes.ts --apply
 */
import dotenv from 'dotenv';
import path from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');

const FOGLINE = '0x0000000000000000000000000000019d9e26795c';
const DOSTOPIA = '0x0000000000000000000000000000019d9df4dbf6';
const DRAGON_EGG = '0x95245242e1e26b8c7d92fd8e4e9274dde600f7d4';

// Fogline nodeIds (verified against titles/plots on 2026-09-24).
const DOSTOPIA_NODE_IDS = new Set([
  86, 87, 95, 105, 107, 109, 111, 112, 113, 114, 115, 116, 118, 120, 121, 123, 125, 130, 132, 134,
  136, 138, 140,
]);
const DRAGON_EGG_NODE_IDS = new Set([97, 99]);

const GEN_EPISODE_TARGET: Record<string, string> = {
  'First Proof: The Unfinished': DOSTOPIA,
  'Dragon Egg — Ember Cradle': DRAGON_EGG,
};

const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));

const app = initializeApp({ credential: cert(serviceAccount) }, `move-fogline-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

const nodesIn = async (universeId: string) =>
  (await db.collection('offChainNodes').where('universeId', '==', universeId).get()).docs;

async function rechain(
  universeId: string,
  label: string,
  dryDocs?: Array<{ id: string; nodeId: number }>
) {
  const docs = (await nodesIn(universeId)).sort((a, b) => a.data().nodeId - b.data().nodeId);
  const seq = dryDocs ?? docs.map((d) => ({ id: d.id, nodeId: d.data().nodeId as number }));
  console.log(`  ${label}: ${seq.map((s) => s.nodeId).join(' -> ')}`);
  if (!APPLY) return;
  const batch = db.batch();
  seq.forEach((s, i) => {
    batch.update(db.collection('offChainNodes').doc(s.id), {
      previousNodeId: i === 0 ? 0 : seq[i - 1].nodeId,
      children: i === seq.length - 1 ? [] : [seq[i + 1].nodeId],
      updatedAt: new Date(),
    });
  });
  await batch.commit();
}

async function main() {
  const fogDocs = await nodesIn(FOGLINE);
  const toDostopia = fogDocs.filter((d) => DOSTOPIA_NODE_IDS.has(d.data().nodeId));
  const toDelete = fogDocs.filter((d) => DRAGON_EGG_NODE_IDS.has(d.data().nodeId));
  const keep = fogDocs.filter(
    (d) => !DOSTOPIA_NODE_IDS.has(d.data().nodeId) && !DRAGON_EGG_NODE_IDS.has(d.data().nodeId)
  );

  // Guards: refuse to run against a state that doesn't match what was verified.
  if (toDostopia.length !== 23 || toDelete.length !== 2 || keep.length !== 36) {
    throw new Error(
      `Unexpected split: dostopia=${toDostopia.length} dragonEgg=${toDelete.length} keep=${keep.length} (want 23/2/36)`
    );
  }
  const dostopiaNodeIds = new Set((await nodesIn(DOSTOPIA)).map((d) => d.data().nodeId));
  const collide = toDostopia.filter((d) => dostopiaNodeIds.has(d.data().nodeId));
  if (collide.length)
    throw new Error(`nodeId collision in Dostopia: ${collide.map((d) => d.data().nodeId)}`);
  const eggTitles = new Set((await nodesIn(DRAGON_EGG)).map((d) => String(d.data().title)));
  for (const d of toDelete) {
    if (!eggTitles.has(String(d.data().title))) {
      throw new Error(
        `Dragon Egg has no existing node titled "${d.data().title}" — refusing to delete`
      );
    }
  }

  const vgSnap = await db.collection('videoGenerations').where('universeId', '==', FOGLINE).get();
  const nodeGenTarget = new Map<string, string>();
  toDostopia.forEach((d) => nodeGenTarget.set(d.data().generationId, DOSTOPIA));
  const vgMoves = vgSnap.docs
    .map((d) => ({
      doc: d,
      target: nodeGenTarget.get(d.id) ?? GEN_EPISODE_TARGET[d.data().episodeTitle],
    }))
    .filter((m) => m.target);

  // Wiki Gallery clips: only ai-video docs, matched by title prefix.
  const contentSnap = await db.collection('content').where('universeId', '==', FOGLINE).get();
  const contentVideos = contentSnap.docs.filter((d) => d.data().mediaType === 'ai-video');
  const clipsToDostopia = contentVideos.filter((d) =>
    /^First Proof — /.test(String(d.data().title))
  );
  const clipsToDelete = contentVideos.filter((d) => /Ember Cradle/.test(String(d.data().title)));
  const eggContentTitles = new Set(
    (await db.collection('content').where('universeId', '==', DRAGON_EGG).get()).docs.map((d) =>
      String(d.data().title)
    )
  );
  for (const d of clipsToDelete) {
    if (!eggContentTitles.has(String(d.data().title))) {
      throw new Error(
        `Dragon Egg wiki has no clip titled "${d.data().title}" — refusing to delete`
      );
    }
  }
  if (clipsToDostopia.length !== 25 || clipsToDelete.length !== 2) {
    throw new Error(
      `Unexpected wiki clips: dostopia=${clipsToDostopia.length} dragonEgg=${clipsToDelete.length} (want 25/2)`
    );
  }

  console.log(
    `Nodes: ${toDostopia.length} -> Dostopia, ${toDelete.length} deleted (already in Dragon Egg), ${keep.length} stay`
  );
  console.log(
    `videoGenerations: ${vgMoves.filter((m) => m.target === DOSTOPIA).length} -> Dostopia, ` +
      `${vgMoves.filter((m) => m.target === DRAGON_EGG).length} -> Dragon Egg, ` +
      `${vgSnap.size - vgMoves.length} stay in Fogline`
  );
  console.log(
    `Wiki clips (content): ${clipsToDostopia.length} -> Dostopia, ${clipsToDelete.length} deleted (already in Dragon Egg), ` +
      `${contentSnap.size - clipsToDostopia.length - clipsToDelete.length} stay in Fogline`
  );
  console.log('\nNew chains:');

  const dostopiaAfter = [
    ...(await nodesIn(DOSTOPIA)).map((d) => ({ id: d.id, nodeId: d.data().nodeId as number })),
    ...toDostopia.map((d) => ({ id: d.id, nodeId: d.data().nodeId as number })),
  ].sort((a, b) => a.nodeId - b.nodeId);
  const foglineAfter = keep
    .map((d) => ({ id: d.id, nodeId: d.data().nodeId as number }))
    .sort((a, b) => a.nodeId - b.nodeId);

  if (!APPLY) {
    await rechain(FOGLINE, 'Fogline ', foglineAfter);
    await rechain(DOSTOPIA, 'Dostopia', dostopiaAfter);
    console.log('\n(DRY RUN — no writes. Re-run with --apply.)');
    return;
  }

  const backupDir = path.join(process.env.HOME!, '.config/loar/media-repair-backups');
  mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `misplaced-fogline-nodes-${Date.now()}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        fogline: fogDocs.map((d) => ({ id: d.id, ...d.data() })),
        dostopiaBefore: (await nodesIn(DOSTOPIA)).map((d) => ({ id: d.id, ...d.data() })),
        videoGenerations: vgMoves.map((m) => ({ id: m.doc.id, from: FOGLINE, to: m.target })),
        content: [...clipsToDostopia, ...clipsToDelete].map((d) => ({ id: d.id, ...d.data() })),
      },
      null,
      2
    )
  );
  console.log(`Backup written: ${backupPath}`);

  const batch = db.batch();
  for (const d of toDostopia) batch.update(d.ref, { universeId: DOSTOPIA, updatedAt: new Date() });
  for (const d of toDelete) batch.delete(d.ref);
  for (const m of vgMoves) batch.update(m.doc.ref, { universeId: m.target });
  for (const d of clipsToDostopia)
    batch.update(d.ref, { universeId: DOSTOPIA, updatedAt: new Date() });
  for (const d of clipsToDelete) batch.delete(d.ref);
  await batch.commit();

  await rechain(FOGLINE, 'Fogline ', foglineAfter);
  await rechain(DOSTOPIA, 'Dostopia', dostopiaAfter);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MOVE FAILED:', err);
  process.exit(1);
});

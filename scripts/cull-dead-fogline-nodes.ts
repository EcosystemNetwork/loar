/**
 * Cull/repair offChainNodes for the Fogline universe.
 *
 * Decision rule per node:
 *   1. Probe node.videoUrl.  Alive → KEEP as-is.
 *   2. Dead, BUT a videoGeneration for the same sceneId has a working
 *      permanentVideoUrl (rehosted to Pinata) → REPAIR (rewrite videoUrl).
 *   3. Dead AND no rehost available, BUT a soundNode points at this node
 *      via startAtNodeId → KEEP (preserve audio attachment, video is just gone).
 *   4. Dead, no rehost, no audio attached → DELETE.
 *
 * Fogline currently has no audio assets, so rule (3) is a defensive guard.
 *
 * Usage:
 *   pnpm tsx scripts/cull-dead-fogline-nodes.ts            # dry-run report
 *   pnpm tsx scripts/cull-dead-fogline-nodes.ts --apply    # actually mutate
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const UNIVERSE_ID = '0x0000000000000000000000000000019d9e26795c';

const sa = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
    ),
    'utf-8'
  )
);
const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);
db.settings({ preferRest: true });

type Probe = { alive: boolean; status: number | string };
type NodeRow = {
  docId: string;
  nodeId: number | string;
  sceneId?: number;
  url: string;
  probe: Probe;
};

// Pinata's public gateway currently 401s on bare HEAD even for pinned CIDs,
// so for any URL that carries an IPFS CID we verify against a public gateway
// instead of trusting the original host. "We have the video" = "the CID is
// resolvable somewhere", not "the original URL still works".
const IPFS_CID_RE = /\/ipfs\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58,})/;
const PUBLIC_IPFS_GATEWAY = 'https://dweb.link/ipfs/';

async function probe(url: string): Promise<Probe> {
  if (!url) return { alive: false, status: 'empty-url' };
  const cidMatch = url.match(IPFS_CID_RE);
  if (cidMatch) {
    const cid = cidMatch[1];
    try {
      const r = await fetch(PUBLIC_IPFS_GATEWAY + cid, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0' },
      });
      if (r.ok || r.status === 206) return { alive: true, status: `ipfs:${r.status}` };
      return { alive: false, status: `ipfs:${r.status}` };
    } catch (e: any) {
      return { alive: false, status: `ipfs-err:${e?.code || e?.message || 'unknown'}` };
    }
  }
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (head.ok) return { alive: true, status: head.status };
    if (head.status === 405 || head.status === 403) {
      const get = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0' },
      });
      if (get.ok || get.status === 206) return { alive: true, status: get.status };
      return { alive: false, status: get.status };
    }
    return { alive: false, status: head.status };
  } catch (e: any) {
    return { alive: false, status: `err:${e?.code || e?.message || 'unknown'}` };
  }
}

async function probeAll<T extends { url: string }>(
  rows: T[],
  concurrency = 8
): Promise<(T & { probe: Probe })[]> {
  const out: (T & { probe: Probe })[] = [];
  for (let i = 0; i < rows.length; i += concurrency) {
    const slice = rows.slice(i, i + concurrency);
    const r = await Promise.all(
      slice.map(async (row) => ({ ...row, probe: await probe(row.url) }))
    );
    out.push(...r);
    process.stdout.write(`  probed ${Math.min(i + concurrency, rows.length)}/${rows.length}\r`);
  }
  console.log('');
  return out;
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will mutate)' : 'DRY-RUN (no writes)'}\n`);

  // --- 1. Pull nodes + probe their current videoUrl
  const nodesSnap = await db
    .collection('offChainNodes')
    .where('universeId', '==', UNIVERSE_ID)
    .get();
  console.log(`Probing ${nodesSnap.size} offChainNodes…`);
  const probedNodes: NodeRow[] = await probeAll(
    nodesSnap.docs.map((d) => {
      const data = d.data() as any;
      return {
        docId: d.id,
        nodeId: data.nodeId,
        sceneId: typeof data.sceneId === 'number' ? data.sceneId : undefined,
        url: String(data.videoUrl || ''),
      };
    })
  );

  const aliveNodes = probedNodes.filter((n) => n.probe.alive);
  const deadNodes = probedNodes.filter((n) => !n.probe.alive);
  console.log(`  alive: ${aliveNodes.length}   dead: ${deadNodes.length}\n`);

  // --- 2. Build sceneId → permanentVideoUrl map (only for URLs that work)
  const vgSnap = await db
    .collection('videoGenerations')
    .where('universeId', '==', UNIVERSE_ID)
    .get();
  const candidates = vgSnap.docs
    .map((d) => {
      const data = d.data() as any;
      return {
        sceneId: typeof data.sceneId === 'number' ? data.sceneId : undefined,
        url: String(data.permanentVideoUrl || ''),
      };
    })
    .filter((r) => r.sceneId != null && r.url);
  console.log(`Probing ${candidates.length} candidate permanentVideoUrls for repair…`);
  const probedCands = await probeAll(candidates);
  const repairMap = new Map<number, string>();
  probedCands.forEach((c) => {
    if (c.probe.alive && !repairMap.has(c.sceneId!)) repairMap.set(c.sceneId!, c.url);
  });
  console.log(`  ${repairMap.size} scenes have a working permanent rehost\n`);

  // --- 3. Pull soundNodes that reference any fogline node by startAtNodeId
  const soundSnap = await db.collection('soundNodes').where('universeId', '==', UNIVERSE_ID).get();
  const audioGuardedNodeIds = new Set<string>();
  soundSnap.docs.forEach((d) => {
    const data = d.data() as any;
    if (data.startAtNodeId != null) audioGuardedNodeIds.add(String(data.startAtNodeId));
  });
  console.log(`soundNodes guarding nodes: ${audioGuardedNodeIds.size}\n`);

  // --- 4. Decide per dead node
  const toRepair: { docId: string; nodeId: number | string; newUrl: string }[] = [];
  const toKeepForAudio: NodeRow[] = [];
  const toDelete: NodeRow[] = [];
  for (const n of deadNodes) {
    const repairUrl = n.sceneId != null ? repairMap.get(n.sceneId) : undefined;
    if (repairUrl) {
      toRepair.push({ docId: n.docId, nodeId: n.nodeId, newUrl: repairUrl });
    } else if (audioGuardedNodeIds.has(String(n.nodeId))) {
      toKeepForAudio.push(n);
    } else {
      toDelete.push(n);
    }
  }

  console.log('=== PLAN ===');
  console.log(`  alive (keep)            : ${aliveNodes.length}`);
  console.log(`  dead → repair via Pinata: ${toRepair.length}`);
  console.log(`  dead → keep (has audio) : ${toKeepForAudio.length}`);
  console.log(`  dead → DELETE           : ${toDelete.length}`);
  console.log('');

  if (toRepair.length) {
    console.log('Repair plan (first 10):');
    toRepair.slice(0, 10).forEach((r) => {
      console.log(`  node=${r.nodeId}  →  ${r.newUrl.slice(0, 70)}`);
    });
    if (toRepair.length > 10) console.log(`  ... ${toRepair.length - 10} more`);
    console.log('');
  }
  if (toDelete.length) {
    console.log('Delete plan:');
    toDelete.forEach((n) => {
      console.log(`  node=${n.nodeId}  scene=${n.sceneId ?? '—'}  status=${n.probe.status}`);
    });
    console.log('');
  }

  if (!APPLY) {
    console.log('[dry-run] Re-run with --apply to mutate.');
    return;
  }

  // --- 5. Apply
  if (toRepair.length === 0 && toDelete.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Firestore batch limit is 500, and we have <100 ops here, so one batch is fine.
  const batch = db.batch();
  toRepair.forEach((r) =>
    batch.update(db.collection('offChainNodes').doc(r.docId), {
      videoUrl: r.newUrl,
      updatedAt: FieldValue.serverTimestamp(),
    })
  );
  toDelete.forEach((n) => batch.delete(db.collection('offChainNodes').doc(n.docId)));
  await batch.commit();
  console.log(`✓ Repaired ${toRepair.length}, deleted ${toDelete.length} offChainNodes.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

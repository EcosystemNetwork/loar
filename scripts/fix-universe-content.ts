/**
 * End-to-end "fix it" script: probe every offChainNode, every episode clip,
 * every videoGeneration permanentVideoUrl. Then:
 *
 *   1. Cull offChainNodes whose videoUrl is dead AND no permanentVideoUrl
 *      rehost is available AND no soundNode references the node.
 *   2. Repair offChainNodes with a working rehost (rewrite videoUrl).
 *   3. For every episode, drop clips whose own videoUrl is dead. If a clip's
 *      nodeId points at a node that was repaired, rewrite the clip url too.
 *      If clipCount drops to zero, delete the episode.
 *   4. For any non-hidden universe that ends up with zero alive offChainNodes
 *      AND zero canon episodes after the cleanup, set isHidden=true so it
 *      stops showing on the home page with broken content.
 *
 * Safe by default: dry-run unless --apply is passed.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const PINATA_TOKEN = process.env.PINATA_GATEWAY_TOKEN || '';

function authedUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (
      /\.mypinata\.cloud$/i.test(u.host) &&
      PINATA_TOKEN &&
      !u.searchParams.has('pinataGatewayToken')
    ) {
      u.searchParams.set('pinataGatewayToken', PINATA_TOKEN);
      return u.toString();
    }
  } catch {}
  return raw;
}

async function probe(rawUrl: string): Promise<boolean> {
  if (!rawUrl) return false;
  if (rawUrl.startsWith('https://dry-run')) return false;
  const url = authedUrl(rawUrl);
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow' });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const isMedia =
      ct.startsWith('video/') ||
      ct.startsWith('image/') ||
      ct.startsWith('audio/') ||
      ct.startsWith('application/octet-stream') ||
      ct.startsWith('application/vnd.apple.mpegurl');
    if (r.ok && isMedia) {
      try {
        await r.arrayBuffer();
      } catch {}
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function probeAll<T>(
  rows: T[],
  get: (r: T) => string,
  concurrency = 16
): Promise<Map<T, boolean>> {
  const out = new Map<T, boolean>();
  for (let i = 0; i < rows.length; i += concurrency) {
    const slice = rows.slice(i, i + concurrency);
    const r = await Promise.all(slice.map(async (row) => [row, await probe(get(row))] as const));
    r.forEach(([row, alive]) => out.set(row, alive));
    process.stdout.write(`  probed ${Math.min(i + concurrency, rows.length)}/${rows.length}\r`);
  }
  console.log('');
  return out;
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  const existing = getApps()[0];
  let db;
  if (existing) {
    db = getFirestore(existing);
  } else {
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
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  const [unisSnap, ocSnap, epSnap, vgSnap, soundSnap] = await Promise.all([
    db.collection('cinematicUniverses').get(),
    db.collection('offChainNodes').get(),
    db.collection('episodes').get(),
    db.collection('videoGenerations').get(),
    db.collection('soundNodes').get(),
  ]);

  // ── Probe nodes ──
  console.log(`Probing ${ocSnap.size} offChainNodes…`);
  const nodeRows = ocSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      docId: d.id,
      universeId: String(data.universeId || '').toLowerCase(),
      nodeId: data.nodeId,
      sceneId: typeof data.sceneId === 'number' ? data.sceneId : undefined,
      url: String(data.videoUrl || ''),
    };
  });
  const nodeAlive = await probeAll(nodeRows, (r) => r.url);

  // ── Probe permanentVideoUrls for repair ──
  console.log(`Probing ${vgSnap.size} videoGeneration permanentVideoUrls…`);
  const vgRows = vgSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      universeId: String(data.universeId || '').toLowerCase(),
      sceneId: typeof data.sceneId === 'number' ? data.sceneId : undefined,
      url: String(data.permanentVideoUrl || data.videoUrl || ''),
    };
  });
  const vgAlive = await probeAll(vgRows, (r) => r.url);
  const repairKey = (uni: string, scene: number) => `${uni}|${scene}`;
  const repairMap = new Map<string, string>();
  for (const r of vgRows) {
    if (vgAlive.get(r) && r.universeId && r.sceneId != null && r.url) {
      const k = repairKey(r.universeId, r.sceneId);
      if (!repairMap.has(k)) repairMap.set(k, r.url);
    }
  }
  console.log(`  ${repairMap.size} (universe,scene) pairs have a working rehost`);

  // ── Audio guard ──
  const audioGuarded = new Set<string>();
  soundSnap.docs.forEach((d) => {
    const data = d.data() as any;
    const uni = String(data.universeId || '').toLowerCase();
    if (data.startAtNodeId != null && uni) audioGuarded.add(`${uni}|${String(data.startAtNodeId)}`);
  });

  // ── Decide per-node ──
  const toRepair: { docId: string; universeId: string; nodeId: any; newUrl: string }[] = [];
  const toKeepForAudio: typeof nodeRows = [];
  const toDeleteNodes: typeof nodeRows = [];
  const aliveNodes: typeof nodeRows = [];
  for (const n of nodeRows) {
    if (nodeAlive.get(n)) {
      aliveNodes.push(n);
      continue;
    }
    const repairUrl =
      n.sceneId != null ? repairMap.get(repairKey(n.universeId, n.sceneId)) : undefined;
    if (repairUrl) {
      toRepair.push({
        docId: n.docId,
        universeId: n.universeId,
        nodeId: n.nodeId,
        newUrl: repairUrl,
      });
    } else if (audioGuarded.has(`${n.universeId}|${String(n.nodeId)}`)) {
      toKeepForAudio.push(n);
    } else {
      toDeleteNodes.push(n);
    }
  }

  // After repair, what nodes will be "alive" (alive originally OR repaired OR audio-guarded)?
  const willBeAliveByUni = new Map<string, number>();
  const bumpAlive = (uni: string) =>
    willBeAliveByUni.set(uni, (willBeAliveByUni.get(uni) ?? 0) + 1);
  aliveNodes.forEach((n) => bumpAlive(n.universeId));
  toRepair.forEach((n) => bumpAlive(n.universeId));
  toKeepForAudio.forEach((n) => bumpAlive(n.universeId));

  // Maps for episode sync.
  const repairByUniNodeId = new Map<string, string>();
  toRepair.forEach((r) => repairByUniNodeId.set(`${r.universeId}|${String(r.nodeId)}`, r.newUrl));
  const willDeleteNode = new Set<string>();
  toDeleteNodes.forEach((n) => willDeleteNode.add(`${n.universeId}|${String(n.nodeId)}`));

  // ── Probe every episode clip individually so we can prune precisely ──
  console.log(`Probing every clip across ${epSnap.size} episodes…`);
  type Clip = {
    nodeId?: any;
    videoUrl: string;
    label?: string;
    [k: string]: any;
  };
  type EpRow = {
    docId: string;
    universeId: string;
    isCanon: boolean;
    title: string;
    clips: Clip[];
  };
  const epRows: EpRow[] = epSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      docId: d.id,
      universeId: String(data.universeId || '').toLowerCase(),
      isCanon: !!data.isCanon,
      title: String(data.title || ''),
      clips: Array.isArray(data.clips) ? data.clips : [],
    };
  });
  // Flatten every clip so we can probe them in one pass.
  type ClipProbe = { ep: EpRow; idx: number; url: string };
  const allClips: ClipProbe[] = [];
  for (const ep of epRows) {
    ep.clips.forEach((c, idx) => allClips.push({ ep, idx, url: String(c.videoUrl || '') }));
  }
  const clipAlive = await probeAll(allClips, (r) => r.url);

  // ── Decide per-episode ──
  type EpUpdate = {
    docId: string;
    universeId: string;
    title: string;
    newClips: Clip[];
    droppedClips: number;
    rewroteClips: number;
    willDelete: boolean;
  };
  const epUpdates: EpUpdate[] = [];
  const willDeleteEpisode = new Set<string>();
  const aliveCanonEpsByUni = new Map<string, number>();
  for (const ep of epRows) {
    let dropped = 0;
    let rewrote = 0;
    const newClips: Clip[] = [];
    ep.clips.forEach((c, idx) => {
      const probeRow = allClips.find((p) => p.ep.docId === ep.docId && p.idx === idx)!;
      const aliveOriginal = clipAlive.get(probeRow);
      const nodeKey = c.nodeId != null ? `${ep.universeId}|${String(c.nodeId)}` : null;
      const repaired = nodeKey ? repairByUniNodeId.get(nodeKey) : undefined;
      if (repaired) {
        // Use the rehost URL.
        if (c.videoUrl !== repaired) rewrote++;
        newClips.push({ ...c, videoUrl: repaired });
      } else if (aliveOriginal) {
        newClips.push(c);
      } else {
        // Dead and no rehost — drop.
        dropped++;
      }
    });

    if (dropped === 0 && rewrote === 0) {
      if (ep.isCanon && newClips.length > 0)
        aliveCanonEpsByUni.set(ep.universeId, (aliveCanonEpsByUni.get(ep.universeId) ?? 0) + 1);
      continue;
    }

    const willDelete = newClips.length === 0;
    epUpdates.push({
      docId: ep.docId,
      universeId: ep.universeId,
      title: ep.title,
      newClips,
      droppedClips: dropped,
      rewroteClips: rewrote,
      willDelete,
    });
    if (willDelete) willDeleteEpisode.add(ep.docId);
    else if (ep.isCanon)
      aliveCanonEpsByUni.set(ep.universeId, (aliveCanonEpsByUni.get(ep.universeId) ?? 0) + 1);
  }

  // ── Decide which universes should be hidden ──
  type UniDecision = {
    addr: string;
    name: string;
    isHidden: boolean;
    aliveNodes: number;
    aliveCanonEps: number;
    shouldHide: boolean;
  };
  const uniDecisions: UniDecision[] = [];
  for (const d of unisSnap.docs) {
    const u = d.data() as any;
    const addr = (u.address || u.id || d.id).toLowerCase();
    const aliveNodeCount = willBeAliveByUni.get(addr) ?? 0;
    const aliveCanon = aliveCanonEpsByUni.get(addr) ?? 0;
    const isHidden = !!u.isHidden;
    const shouldHide = !isHidden && aliveNodeCount === 0 && aliveCanon === 0;
    uniDecisions.push({
      addr,
      name: u.name || '(unnamed)',
      isHidden,
      aliveNodes: aliveNodeCount,
      aliveCanonEps: aliveCanon,
      shouldHide,
    });
  }
  const toHide = uniDecisions.filter((u) => u.shouldHide);

  // ── Plan summary ──
  console.log('\n=== UNIVERSE STATE AFTER FIX ===');
  console.log(
    'name'.padEnd(34) +
      'addr'.padEnd(14) +
      'aliveNodes'.padEnd(12) +
      'aliveCanon'.padEnd(12) +
      'flag'
  );
  uniDecisions
    .filter((u) => u.aliveNodes + u.aliveCanonEps > 0 || !u.isHidden)
    .sort((a, b) => b.aliveNodes - a.aliveNodes)
    .forEach((u) =>
      console.log(
        u.name.slice(0, 32).padEnd(34) +
          u.addr.slice(0, 12).padEnd(14) +
          String(u.aliveNodes).padEnd(12) +
          String(u.aliveCanonEps).padEnd(12) +
          (u.shouldHide ? 'WILL-HIDE' : u.isHidden ? 'already-hidden' : 'visible')
      )
    );

  console.log('\n=== TOTALS ===');
  console.log(`offChainNodes alive (keep):       ${aliveNodes.length}`);
  console.log(`offChainNodes repair (rehost):    ${toRepair.length}`);
  console.log(`offChainNodes keep-for-audio:     ${toKeepForAudio.length}`);
  console.log(`offChainNodes DELETE:             ${toDeleteNodes.length}`);
  console.log(`episodes update (clip prune):     ${epUpdates.filter((e) => !e.willDelete).length}`);
  console.log(`episodes DELETE (zero clips):     ${epUpdates.filter((e) => e.willDelete).length}`);
  console.log(`universes to HIDE:                ${toHide.length}`);
  if (toHide.length) toHide.forEach((u) => console.log(`  → hide: ${u.name}  ${u.addr}`));

  if (epUpdates.length) {
    console.log('\nEpisode plan:');
    epUpdates
      .slice(0, 12)
      .forEach((e) =>
        console.log(
          `  ${e.docId.slice(0, 12)}…  uni=${e.universeId.slice(0, 10)}  ` +
            `dropped=${e.droppedClips} rewrote=${e.rewroteClips}` +
            (e.willDelete ? ' [DELETE]' : ` newCount=${e.newClips.length}`)
        )
      );
    if (epUpdates.length > 12) console.log(`  ... ${epUpdates.length - 12} more`);
  }

  if (!APPLY) {
    console.log('\n[dry-run] Re-run with --apply to mutate.');
    return;
  }

  // ── Apply ──
  let batch = db.batch();
  let count = 0;
  const flush = async (label: string) => {
    if (count === 0) return;
    await batch.commit();
    console.log(`  committed ${count} ${label} ops`);
    batch = db.batch();
    count = 0;
  };

  // Repairs
  for (const r of toRepair) {
    batch.update(db.collection('offChainNodes').doc(r.docId), {
      videoUrl: r.newUrl,
      updatedAt: FieldValue.serverTimestamp(),
    });
    count++;
    if (count >= 400) await flush('node-repair');
  }
  await flush('node-repair');

  // Node deletes
  for (const n of toDeleteNodes) {
    batch.delete(db.collection('offChainNodes').doc(n.docId));
    count++;
    if (count >= 400) await flush('node-delete');
  }
  await flush('node-delete');

  // Episode updates / deletes
  for (const e of epUpdates) {
    if (e.willDelete) {
      batch.delete(db.collection('episodes').doc(e.docId));
    } else {
      batch.update(db.collection('episodes').doc(e.docId), {
        clips: e.newClips,
        clipCount: e.newClips.length,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    count++;
    if (count >= 400) await flush('episode-sync');
  }
  await flush('episode-sync');

  // Hide universes with no working content
  for (const u of toHide) {
    batch.update(db.collection('cinematicUniverses').doc(u.addr), {
      isHidden: true,
      hiddenReason: 'no-working-content',
      hiddenAt: FieldValue.serverTimestamp(),
    });
    count++;
    if (count >= 400) await flush('universe-hide');
  }
  await flush('universe-hide');

  console.log(
    `\n✓ Done: ${toRepair.length} nodes repaired, ${toDeleteNodes.length} nodes deleted, ` +
      `${epUpdates.filter((e) => !e.willDelete).length} episodes pruned, ` +
      `${epUpdates.filter((e) => e.willDelete).length} episodes deleted, ` +
      `${toHide.length} universes hidden.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

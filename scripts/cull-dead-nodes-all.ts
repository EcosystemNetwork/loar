/**
 * Cross-universe version of cull-dead-fogline-nodes.ts.
 *
 * Walks every offChainNode across every cinematicUniverse and decides:
 *   1. videoUrl probes alive  → KEEP as-is.
 *   2. videoUrl dead, but a videoGeneration with the same sceneId has a
 *      working permanentVideoUrl → REPAIR (rewrite videoUrl to the rehost).
 *   3. videoUrl dead, no rehost, but a soundNode points at this node via
 *      startAtNodeId → KEEP (preserve audio attachment).
 *   4. videoUrl missing or dead, no rehost, no audio attached → DELETE.
 *
 * After mutating offChainNodes, walks every `episodes` doc and:
 *   - Rewrites clip.videoUrl when the referenced node was repaired.
 *   - Drops clips whose node was deleted.
 *   - Recomputes clipCount; if clipCount drops to 0, deletes the episode.
 *
 * Usage:
 *   pnpm tsx scripts/cull-dead-nodes-all.ts            # dry-run report
 *   pnpm tsx scripts/cull-dead-nodes-all.ts --apply    # actually mutate
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');

type Probe = { alive: boolean; status: number | string };
type NodeRow = {
  docId: string;
  universeId: string;
  nodeId: number | string;
  sceneId?: number;
  url: string;
  probe: Probe;
};

const PINATA_TOKEN = process.env.PINATA_GATEWAY_TOKEN || '';

/**
 * Append the Pinata gateway token to dedicated-gateway URLs so we don't get
 * a spurious 401. Without this, every *.mypinata.cloud URL probes as dead.
 */
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
  } catch {
    // fall through
  }
  return raw;
}

/**
 * A URL is alive only if a GET returns a media content-type. HEAD is unreliable
 * (some CDNs return 200 on HEAD but 403 on GET), and 401/403 with a JSON or
 * text/html body almost always means an expired signed URL or a dropped CID
 * (real example: volces.com signed URLs return 403 application/json after
 * expiry; Pinata returns 403 text/plain for CIDs no longer pinned). So:
 *   - GET (no Range, follow redirects)
 *   - 2xx + content-type starts with video/, image/, audio/, application/octet-stream → alive
 *   - any other status, or any HTML/JSON/text body → dead
 */
async function probe(rawUrl: string): Promise<Probe> {
  if (!rawUrl) return { alive: false, status: 'empty-url' };
  const url = authedUrl(rawUrl);
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow' });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const isMedia =
      ct.startsWith('video/') ||
      ct.startsWith('image/') ||
      ct.startsWith('audio/') ||
      ct.startsWith('application/octet-stream') ||
      ct.startsWith('application/vnd.apple.mpegurl') ||
      ct.startsWith('application/x-mpegurl');
    if (r.ok && isMedia) {
      // Drain to release the connection promptly without holding the body in
      // memory longer than necessary.
      try {
        await r.arrayBuffer();
      } catch {}
      return { alive: true, status: r.status };
    }
    return { alive: false, status: `${r.status}:${ct || 'no-ct'}` };
  } catch (e: any) {
    return { alive: false, status: `err:${e?.code || e?.message || 'unknown'}` };
  }
}

async function probeAll<T extends { url: string }>(
  rows: T[],
  concurrency = 16
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

  // --- 1. Pull every offChainNode and probe.
  const ocSnap = await db.collection('offChainNodes').get();
  console.log(`Probing ${ocSnap.size} offChainNodes across all universes…`);
  const probedNodes: NodeRow[] = await probeAll(
    ocSnap.docs.map((d) => {
      const data = d.data() as any;
      return {
        docId: d.id,
        universeId: String(data.universeId || '').toLowerCase(),
        nodeId: data.nodeId,
        sceneId: typeof data.sceneId === 'number' ? data.sceneId : undefined,
        url: String(data.videoUrl || ''),
      };
    })
  );

  const aliveNodes = probedNodes.filter((n) => n.probe.alive);
  const deadNodes = probedNodes.filter((n) => !n.probe.alive);
  console.log(`  alive: ${aliveNodes.length}   dead/empty: ${deadNodes.length}\n`);

  // --- 2. Build (universeId, sceneId) → permanentVideoUrl map for rehosts.
  const vgSnap = await db.collection('videoGenerations').get();
  const candidates = vgSnap.docs
    .map((d) => {
      const data = d.data() as any;
      return {
        universeId: String(data.universeId || '').toLowerCase(),
        sceneId: typeof data.sceneId === 'number' ? data.sceneId : undefined,
        url: String(data.permanentVideoUrl || ''),
      };
    })
    .filter((r) => r.universeId && r.sceneId != null && r.url);
  console.log(`Probing ${candidates.length} candidate permanentVideoUrls for repair…`);
  const probedCands = await probeAll(candidates);
  const repairMap = new Map<string, string>();
  const repairKey = (universeId: string, sceneId: number) => `${universeId}|${sceneId}`;
  probedCands.forEach((c) => {
    if (c.probe.alive) {
      const k = repairKey(c.universeId, c.sceneId!);
      if (!repairMap.has(k)) repairMap.set(k, c.url);
    }
  });
  console.log(`  ${repairMap.size} (universe,scene) pairs have a working rehost\n`);

  // --- 3. Build (universeId, nodeId) audio-guard set.
  const soundSnap = await db.collection('soundNodes').get();
  const audioGuarded = new Set<string>();
  soundSnap.docs.forEach((d) => {
    const data = d.data() as any;
    const uni = String(data.universeId || '').toLowerCase();
    if (data.startAtNodeId != null && uni) audioGuarded.add(`${uni}|${String(data.startAtNodeId)}`);
  });
  console.log(`soundNodes guarding nodes: ${audioGuarded.size}\n`);

  // --- 4. Decide per dead node.
  const toRepair: { docId: string; universeId: string; nodeId: number | string; newUrl: string }[] =
    [];
  const toKeepForAudio: NodeRow[] = [];
  const toDelete: NodeRow[] = [];
  for (const n of deadNodes) {
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
      toDelete.push(n);
    }
  }

  // --- 5. Group plan by universe.
  type UniPlan = { repair: number; keepForAudio: number; del: number };
  const planByUni = new Map<string, UniPlan>();
  const bump = (uni: string, key: keyof UniPlan) => {
    const cur = planByUni.get(uni) ?? { repair: 0, keepForAudio: 0, del: 0 };
    cur[key]++;
    planByUni.set(uni, cur);
  };
  toRepair.forEach((r) => bump(r.universeId, 'repair'));
  toKeepForAudio.forEach((n) => bump(n.universeId, 'keepForAudio'));
  toDelete.forEach((n) => bump(n.universeId, 'del'));

  // Hydrate universe names for the report.
  const uniIds = Array.from(planByUni.keys());
  const uniNameMap = new Map<string, string>();
  if (uniIds.length) {
    const refs = uniIds.map((id) => db.collection('cinematicUniverses').doc(id));
    const docs = await db.getAll(...refs);
    docs.forEach((d) => {
      if (d.exists) {
        const data = d.data() as any;
        uniNameMap.set(d.id, data.name || '(unnamed)');
      }
    });
  }

  console.log('=== PLAN BY UNIVERSE ===');
  console.log(
    'name'.padEnd(36) + 'addr'.padEnd(14) + 'repair'.padEnd(10) + 'keep-audio'.padEnd(14) + 'delete'
  );
  Array.from(planByUni.entries())
    .sort((a, b) => b[1].del + b[1].repair - (a[1].del + a[1].repair))
    .forEach(([uni, p]) => {
      const name = uniNameMap.get(uni) || '(unknown)';
      console.log(
        name.slice(0, 34).padEnd(36) +
          uni.slice(0, 12).padEnd(14) +
          String(p.repair).padEnd(10) +
          String(p.keepForAudio).padEnd(14) +
          String(p.del)
      );
    });

  console.log('\n=== TOTALS ===');
  console.log(`  alive (keep)            : ${aliveNodes.length}`);
  console.log(`  dead → repair via rehost: ${toRepair.length}`);
  console.log(`  dead → keep (has audio) : ${toKeepForAudio.length}`);
  console.log(`  dead → DELETE           : ${toDelete.length}`);

  // --- 6. Episode clip sync plan.
  const repairByDocId = new Map<string, string>();
  toRepair.forEach((r) => repairByDocId.set(r.docId, r.newUrl));
  // Also a (universeId, nodeIdString) → newUrl map for clip lookups.
  const repairByUniNode = new Map<string, string>();
  toRepair.forEach((r) => repairByUniNode.set(`${r.universeId}|${String(r.nodeId)}`, r.newUrl));
  // Deleted node set, keyed (universeId, nodeIdString).
  const deletedSet = new Set<string>();
  toDelete.forEach((n) => deletedSet.add(`${n.universeId}|${String(n.nodeId)}`));

  const epSnap = await db.collection('episodes').get();
  type EpUpdate = {
    docId: string;
    newClips: any[];
    droppedClips: number;
    rewroteClips: number;
    willDelete: boolean;
  };
  const epUpdates: EpUpdate[] = [];
  for (const d of epSnap.docs) {
    const data = d.data() as any;
    const uni = String(data.universeId || '').toLowerCase();
    if (!uni) continue;
    const clips: any[] = Array.isArray(data.clips) ? data.clips : [];
    if (clips.length === 0) continue;

    let dropped = 0;
    let rewrote = 0;
    const newClips: any[] = [];
    for (const c of clips) {
      const nodeId = c.nodeId != null ? String(c.nodeId) : null;
      if (nodeId && deletedSet.has(`${uni}|${nodeId}`)) {
        dropped++;
        continue;
      }
      const repairUrl = nodeId ? repairByUniNode.get(`${uni}|${nodeId}`) : undefined;
      if (repairUrl && c.videoUrl !== repairUrl) {
        newClips.push({ ...c, videoUrl: repairUrl });
        rewrote++;
      } else {
        newClips.push(c);
      }
    }

    if (dropped === 0 && rewrote === 0) continue;
    epUpdates.push({
      docId: d.id,
      newClips,
      droppedClips: dropped,
      rewroteClips: rewrote,
      willDelete: newClips.length === 0,
    });
  }

  if (epUpdates.length) {
    console.log('\n=== EPISODE CLIP SYNC ===');
    console.log(`  episodes affected:        ${epUpdates.length}`);
    console.log(
      `  episodes to delete (0 clips left): ${epUpdates.filter((e) => e.willDelete).length}`
    );
    const dropTotal = epUpdates.reduce((s, e) => s + e.droppedClips, 0);
    const rewriteTotal = epUpdates.reduce((s, e) => s + e.rewroteClips, 0);
    console.log(`  total clips dropped:      ${dropTotal}`);
    console.log(`  total clips rewritten:    ${rewriteTotal}`);
    epUpdates
      .slice(0, 8)
      .forEach((e) =>
        console.log(
          `    ${e.docId.slice(0, 12)}…  dropped=${e.droppedClips} rewrote=${e.rewroteClips}` +
            (e.willDelete ? ' [DELETE]' : '')
        )
      );
    if (epUpdates.length > 8) console.log(`    ... ${epUpdates.length - 8} more`);
  } else {
    console.log('\n=== EPISODE CLIP SYNC === (no changes)');
  }

  if (!APPLY) {
    console.log('\n[dry-run] Re-run with --apply to mutate.');
    return;
  }

  // --- 7. Apply, batched at 400 ops to stay safely under the 500-op limit.
  const ops: Array<() => void> = [];
  let batch = db.batch();
  let count = 0;
  const flush = async (label: string) => {
    if (count === 0) return;
    await batch.commit();
    console.log(`  committed ${count} ${label} ops`);
    batch = db.batch();
    count = 0;
  };

  for (const r of toRepair) {
    batch.update(db.collection('offChainNodes').doc(r.docId), {
      videoUrl: r.newUrl,
      updatedAt: FieldValue.serverTimestamp(),
    });
    count++;
    if (count >= 400) await flush('node-repair');
  }
  await flush('node-repair');

  for (const n of toDelete) {
    batch.delete(db.collection('offChainNodes').doc(n.docId));
    count++;
    if (count >= 400) await flush('node-delete');
  }
  await flush('node-delete');

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

  console.log(
    `\n✓ Repaired ${toRepair.length} nodes, deleted ${toDelete.length} nodes, synced ${epUpdates.length} episodes (${epUpdates.filter((e) => e.willDelete).length} fully removed).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

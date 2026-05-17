/**
 * Rebuild offChainNodes from videoGenerations that have a permanent URL but
 * no matching offChainNode in their universe. This re-surfaces content on
 * the `/universe/$id/watch` page (which reads offChainNodes), which the
 * 2026-04-27 cull pruned for any node whose URL had decayed.
 *
 * Safe-by-default: dry-run unless --apply.
 *
 * Idempotent: skips videoGenerations that already have a matching offChainNode
 * (matched by `generationId`, which we now stamp on every rebuilt node).
 *
 * Auth: uses gcloud Application Default Credentials (project loar-db).
 */
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';

const APPLY = process.argv.includes('--apply');
const ONLY_UNIVERSE = process.argv.find((a) => a.startsWith('--universe='))?.split('=')[1];

if (!getApps()[0]) initializeApp({ credential: applicationDefault(), projectId: 'loar-db' });
const db = getFirestore();
db.settings({ preferRest: true });

const VOLCES = /volces\.com|bytedance/i;
const FAL = /fal\.(media|ai)/i;
const REPLICATE = /replicate\.delivery/i;
const DRY = /^https:\/\/dry-run/i;

function isEphemeral(u?: string): boolean {
  if (!u) return true;
  return VOLCES.test(u) || FAL.test(u) || REPLICATE.test(u) || DRY.test(u);
}

function preferredUrl(gen: any): string | null {
  if (gen.permanentVideoUrl) return gen.permanentVideoUrl;
  if (gen.videoUrl && !isEphemeral(gen.videoUrl)) return gen.videoUrl;
  return null;
}

function toDate(v: any): Date {
  if (!v) return new Date();
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function main() {
  // Pull universes
  const unisSnap = await db.collection('cinematicUniverses').get();
  const universes = new Map<string, { id: string; name: string; creator: string }>();
  unisSnap.forEach((d) => {
    const v: any = d.data();
    universes.set(d.id.toLowerCase(), {
      id: d.id,
      name: v.name || v.universeName || d.id,
      creator: String(v.creator || v.owner || '').toLowerCase(),
    });
  });

  // Pull existing offChainNodes to compute (a) next nodeId per universe,
  // (b) skip-set by generationId, (c) skip-set by videoUrl (catches nodes
  // created BEFORE we stamped generationId).
  const ocsSnap = await db.collection('offChainNodes').get();
  const maxNodeIdByUni = new Map<string, number>();
  const existingGenIdsByUni = new Map<string, Set<string>>();
  const existingUrlsByUni = new Map<string, Set<string>>();
  ocsSnap.forEach((d) => {
    const v: any = d.data();
    const k = String(v.universeId || '').toLowerCase();
    if (typeof v.nodeId === 'number')
      maxNodeIdByUni.set(k, Math.max(maxNodeIdByUni.get(k) ?? 0, v.nodeId));
    if (v.generationId) {
      let s = existingGenIdsByUni.get(k);
      if (!s) {
        s = new Set();
        existingGenIdsByUni.set(k, s);
      }
      s.add(String(v.generationId));
    }
    if (v.videoUrl) {
      let s = existingUrlsByUni.get(k);
      if (!s) {
        s = new Set();
        existingUrlsByUni.set(k, s);
      }
      s.add(String(v.videoUrl));
    }
  });

  // Pull counters so we don't collide
  const countersSnap = await db.collection('offChainNodeCounters').get();
  countersSnap.forEach((d) => {
    const latest = (d.data() as any).latest;
    if (typeof latest === 'number') {
      const k = d.id.toLowerCase();
      maxNodeIdByUni.set(k, Math.max(maxNodeIdByUni.get(k) ?? 0, latest));
    }
  });

  // Pull completed videoGenerations with universeId
  const vgsSnap = await db.collection('videoGenerations').where('status', '==', 'completed').get();
  type Plan = {
    universeKey: string;
    universeName: string;
    universeCreator: string;
    nodeId: number;
    genId: string;
    videoUrl: string;
    title: string;
    plot: string;
    creator: string;
    createdAt: Date;
  };
  const plansByUni = new Map<string, Plan[]>();
  let skipNoUni = 0,
    skipNoUrl = 0,
    skipAlreadyHasNode = 0,
    skipFiltered = 0;
  const candidates: Array<{ genId: string; uniKey: string; gen: any }> = [];
  vgsSnap.forEach((d) => {
    const gen = d.data() as any;
    const uniKey = String(gen.universeId || '').toLowerCase();
    if (!uniKey || !universes.has(uniKey)) {
      skipNoUni++;
      return;
    }
    if (ONLY_UNIVERSE && uniKey !== ONLY_UNIVERSE.toLowerCase()) {
      skipFiltered++;
      return;
    }
    const url = preferredUrl(gen);
    if (!url) {
      skipNoUrl++;
      return;
    }
    const existingGen = existingGenIdsByUni.get(uniKey);
    if (existingGen && existingGen.has(d.id)) {
      skipAlreadyHasNode++;
      return;
    }
    const existingUrl = existingUrlsByUni.get(uniKey);
    if (existingUrl && existingUrl.has(url)) {
      skipAlreadyHasNode++;
      return;
    }
    candidates.push({ genId: d.id, uniKey, gen });
  });

  // Sort by created date so node IDs follow generation order
  candidates.sort((a, b) => toDate(a.gen.createdAt).getTime() - toDate(b.gen.createdAt).getTime());

  for (const c of candidates) {
    const uni = universes.get(c.uniKey)!;
    const cur = maxNodeIdByUni.get(c.uniKey) ?? 0;
    const next = cur + 1;
    maxNodeIdByUni.set(c.uniKey, next);
    const plan: Plan = {
      universeKey: c.uniKey,
      universeName: uni.name,
      universeCreator: uni.creator,
      nodeId: next,
      genId: c.genId,
      videoUrl: preferredUrl(c.gen)!,
      title: (
        c.gen.sceneTitle ||
        c.gen.title ||
        c.gen.originalPrompt ||
        c.gen.prompt ||
        'Generated'
      ).slice(0, 300),
      plot: String(c.gen.originalPrompt || c.gen.prompt || c.gen.plot || ''),
      creator: String(
        c.gen.userId || c.gen.creatorUid || c.gen.creator || uni.creator || ''
      ).toLowerCase(),
      createdAt: toDate(c.gen.createdAt),
    };
    let arr = plansByUni.get(c.uniKey);
    if (!arr) {
      arr = [];
      plansByUni.set(c.uniKey, arr);
    }
    arr.push(plan);
  }

  // Report
  console.log(`\n=== offChainNode rebuild plan ===`);
  console.log(`  videoGenerations completed total: ${vgsSnap.size}`);
  console.log(`  skipped (no universe or universe missing): ${skipNoUni}`);
  console.log(`  skipped (ephemeral-only URL — bytes lost): ${skipNoUrl}`);
  console.log(`  skipped (already has matching offChainNode): ${skipAlreadyHasNode}`);
  if (ONLY_UNIVERSE) console.log(`  skipped (filter — not target universe): ${skipFiltered}`);
  let totalPlans = 0;
  for (const [k, arr] of [...plansByUni.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const uni = universes.get(k)!;
    totalPlans += arr.length;
    const startId = arr[0]?.nodeId;
    const endId = arr[arr.length - 1]?.nodeId;
    console.log(
      `    ${uni.name.padEnd(36)} +${String(arr.length).padStart(3)} nodes  (#${startId}–#${endId})`
    );
  }
  console.log(`  TOTAL to create: ${totalPlans}\n`);

  if (!APPLY) {
    console.log(`[DRY RUN] no writes. re-run with --apply to commit.`);
    process.exit(0);
  }

  // Commit
  let written = 0;
  const allPlans = [...plansByUni.values()].flat();
  // Firestore batch limit is 500 writes (and each plan does 1 set + counter update => 2)
  for (let i = 0; i < allPlans.length; i += 200) {
    const slice = allPlans.slice(i, i + 200);
    const batch = db.batch();
    for (const p of slice) {
      const docRef = db.collection('offChainNodes').doc();
      const contentHash = keccak256(toBytes(p.videoUrl));
      const plotHash = keccak256(toBytes(p.plot));
      batch.set(docRef, {
        id: randomUUID(),
        universeId: p.universeKey,
        nodeId: p.nodeId,
        creator: p.creator,
        contentHash,
        plotHash,
        videoUrl: p.videoUrl,
        plot: p.plot,
        title: p.title,
        sceneId: null,
        previousNodeId: 0,
        children: [],
        canon: true,
        generationId: p.genId,
        rebuiltAt: new Date(),
        rebuiltReason: '2026-04-27-cull-restore',
        createdAt: p.createdAt,
        updatedAt: new Date(),
      });
    }
    // Update counters to the max nodeId per universe in this slice
    const maxByUni = new Map<string, number>();
    for (const p of slice) {
      maxByUni.set(p.universeKey, Math.max(maxByUni.get(p.universeKey) ?? 0, p.nodeId));
    }
    for (const [k, latest] of maxByUni.entries()) {
      batch.set(
        db.collection('offChainNodeCounters').doc(k),
        { latest, updatedAt: new Date() },
        { merge: true }
      );
    }
    await batch.commit();
    written += slice.length;
    console.log(`  wrote ${written}/${allPlans.length}`);
  }

  console.log(`\n✓ Rebuilt ${written} offChainNodes`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

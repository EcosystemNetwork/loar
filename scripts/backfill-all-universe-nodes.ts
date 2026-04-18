/**
 * Backfill off-chain timeline nodes for ALL universes.
 *
 * For every universe that has entries in `videoGenerations`, this finds videos
 * whose `sceneId` has no corresponding `offChainNodes` doc and creates one,
 * chained sequentially by sceneId — exactly the same logic as
 * `scripts/backfill-fogline-nodes.ts`, but generalized across every universe.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-all-universe-nodes.ts            # audit (dry-run)
 *   pnpm tsx scripts/backfill-all-universe-nodes.ts --apply    # write nodes
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');

const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));
const app = initializeApp({ credential: cert(serviceAccount) }, `backfill-all-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

interface VideoGen {
  id: string;
  universeId?: string;
  videoUrl?: string;
  sceneId?: number;
  sceneTitle?: string;
  prompt?: string;
  fullPrompt?: string;
  creatorUid?: string;
  episodeTitle?: string;
  status?: string;
  createdAt?: any;
}

async function main() {
  console.log(
    APPLY
      ? '🚀 APPLY MODE — writes will be persisted'
      : '🔍 AUDIT MODE — dry run (pass --apply to write)'
  );
  console.log('');

  // 1. Pull every completed video generation
  const allVidsSnap = await db.collection('videoGenerations').get();
  const allVids: VideoGen[] = allVidsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  console.log(`📼 Total videoGenerations docs: ${allVids.length}`);

  // 2. Group by universeId
  const byUniverse = new Map<string, VideoGen[]>();
  let skippedMissingUniverse = 0;
  let skippedMissingUrl = 0;
  let skippedMissingScene = 0;
  for (const v of allVids) {
    if (!v.universeId) {
      skippedMissingUniverse++;
      continue;
    }
    if (!v.videoUrl) {
      skippedMissingUrl++;
      continue;
    }
    if (v.sceneId == null) {
      skippedMissingScene++;
      continue;
    }
    if (!byUniverse.has(v.universeId)) byUniverse.set(v.universeId, []);
    byUniverse.get(v.universeId)!.push(v);
  }
  if (skippedMissingUniverse)
    console.log(`  (skipped ${skippedMissingUniverse} videos with no universeId)`);
  if (skippedMissingUrl) console.log(`  (skipped ${skippedMissingUrl} videos with no videoUrl)`);
  if (skippedMissingScene) console.log(`  (skipped ${skippedMissingScene} videos with no sceneId)`);
  console.log(`🌌 Universes with videos: ${byUniverse.size}`);
  console.log('');

  let totalGaps = 0;
  let totalCreated = 0;
  const perUniverseReport: Array<{
    universeId: string;
    videos: number;
    existing: number;
    gaps: number;
    created: number;
  }> = [];

  for (const [universeId, videos] of byUniverse) {
    // 3. Existing nodes for this universe
    const existingSnap = await db
      .collection('offChainNodes')
      .where('universeId', '==', universeId)
      .get();
    const existingScenes = new Set(
      existingSnap.docs.map((d) => d.data().sceneId).filter((s) => s != null)
    );

    // 4. Determine gap (videos whose sceneId has no node)
    const sorted = [...videos].sort((a, b) => (a.sceneId || 0) - (b.sceneId || 0));
    const missing = sorted.filter((v) => !existingScenes.has(v.sceneId!));

    perUniverseReport.push({
      universeId,
      videos: videos.length,
      existing: existingSnap.size,
      gaps: missing.length,
      created: 0,
    });
    totalGaps += missing.length;

    if (missing.length === 0) continue;

    console.log(`🌌 ${universeId}`);
    console.log(
      `   videos=${videos.length}  existingNodes=${existingSnap.size}  missing=${missing.length}`
    );

    if (!APPLY) {
      for (const v of missing) {
        console.log(
          `     [scene ${v.sceneId}] ${v.sceneTitle || v.episodeTitle || '(untitled)'} → ${v.videoUrl?.slice(0, 70)}...`
        );
      }
      console.log('');
      continue;
    }

    // 5. Apply: get current counter
    const counterRef = db.collection('offChainNodeCounters').doc(universeId);
    const counterDoc = await counterRef.get();
    let lastNodeId = counterDoc.exists ? (counterDoc.data()?.latest as number) || 0 : 0;
    // Defensive: if existing nodes have higher nodeId than counter (e.g. counter never written),
    // bump to match so we don't collide.
    for (const d of existingSnap.docs) {
      const n = d.data().nodeId as number | undefined;
      if (typeof n === 'number' && n > lastNodeId) lastNodeId = n;
    }

    let createdHere = 0;
    for (const video of missing) {
      const newNodeId = lastNodeId + 1;
      const previousNodeId = lastNodeId;
      const contentHash = keccak256(toBytes(video.videoUrl!));
      const plotText = video.fullPrompt || video.prompt || video.sceneTitle || 'Scene';
      const plotHash = keccak256(toBytes(plotText));
      const creator = (video.creatorUid || 'system').toLowerCase();

      const docId = randomUUID();
      await db
        .collection('offChainNodes')
        .doc(docId)
        .set({
          id: docId,
          universeId,
          nodeId: newNodeId,
          creator,
          contentHash,
          plotHash,
          videoUrl: video.videoUrl,
          plot: plotText,
          title: video.sceneTitle || `Scene ${video.sceneId}`,
          sceneId: video.sceneId,
          previousNodeId,
          children: [],
          canon: previousNodeId === 0,
          createdAt: video.createdAt || new Date(),
          updatedAt: new Date(),
        });

      // Append to previous node's children
      if (previousNodeId > 0) {
        const parentSnap = await db
          .collection('offChainNodes')
          .where('universeId', '==', universeId)
          .where('nodeId', '==', previousNodeId)
          .limit(1)
          .get();
        if (!parentSnap.empty) {
          const parent = parentSnap.docs[0];
          const children = (parent.data().children || []) as number[];
          if (!children.includes(newNodeId)) {
            await parent.ref.update({
              children: [...children, newNodeId],
              updatedAt: new Date(),
            });
          }
        }
      }

      lastNodeId = newNodeId;
      createdHere++;
      console.log(`     [+${newNodeId}] scene ${video.sceneId}: ${video.sceneTitle || ''}`);
    }

    await counterRef.set({ latest: lastNodeId, updatedAt: new Date() }, { merge: true });
    perUniverseReport[perUniverseReport.length - 1].created = createdHere;
    totalCreated += createdHere;
    console.log('');
  }

  // 6. Summary
  console.log('───────────────────────────────────────────────────────────────');
  console.log('Summary');
  console.log('───────────────────────────────────────────────────────────────');
  for (const r of perUniverseReport) {
    const tag = r.gaps === 0 ? '✅' : APPLY ? '🛠 ' : '⚠️ ';
    console.log(
      `${tag} ${r.universeId}  videos=${r.videos}  nodes=${r.existing}  gap=${r.gaps}${APPLY ? `  created=${r.created}` : ''}`
    );
  }
  console.log('');
  console.log(`Total gaps: ${totalGaps}`);
  if (APPLY) console.log(`Total nodes created: ${totalCreated}`);
  if (!APPLY && totalGaps > 0)
    console.log(`\nRun with --apply to create the ${totalGaps} missing nodes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

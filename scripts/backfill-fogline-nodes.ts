/**
 * Backfill off-chain timeline nodes for the 7 already-generated Fogline videos.
 * Reads from videoGenerations and creates an offChainNodes doc for each,
 * chained sequentially by sceneId.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));
const app = initializeApp({ credential: cert(serviceAccount) }, `backfill-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9e26795c';
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

async function main() {
  const vids = await db.collection('videoGenerations').where('universeId', '==', UNIVERSE_ID).get();

  // Existing nodes
  const existing = await db
    .collection('offChainNodes')
    .where('universeId', '==', UNIVERSE_ID)
    .get();
  const existingScenes = new Set(existing.docs.map((d) => d.data().sceneId));

  console.log(
    `Found ${vids.size} videos, ${existing.size} existing nodes, ${vids.size - existingScenes.size} need backfill`
  );

  // Sort by sceneId
  const sorted = vids.docs
    .map((d) => ({ id: d.id, ...d.data() }) as any)
    .filter((v) => v.sceneId && v.videoUrl && !existingScenes.has(v.sceneId))
    .sort((a, b) => (a.sceneId || 0) - (b.sceneId || 0));

  // Get current counter
  const counterRef = db.collection('offChainNodeCounters').doc(UNIVERSE_ID);
  const counterDoc = await counterRef.get();
  let lastNodeId = counterDoc.exists ? (counterDoc.data()?.latest as number) || 0 : 0;

  for (const video of sorted) {
    const newNodeId = lastNodeId + 1;
    const previousNodeId = lastNodeId;
    const contentHash = keccak256(toBytes(video.videoUrl));
    const plotText = video.fullPrompt || video.prompt || video.sceneTitle || 'Scene';
    const plotHash = keccak256(toBytes(plotText));

    const docId = randomUUID();
    await db
      .collection('offChainNodes')
      .doc(docId)
      .set({
        id: docId,
        universeId: UNIVERSE_ID,
        nodeId: newNodeId,
        creator: CREATOR_ADDRESS.toLowerCase(),
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
        .where('universeId', '==', UNIVERSE_ID)
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
    console.log(`  [${newNodeId}] Scene ${video.sceneId}: ${video.sceneTitle}`);
  }

  // Update counter
  await counterRef.set({ latest: lastNodeId, updatedAt: new Date() }, { merge: true });

  console.log(`\n✅ Backfilled ${sorted.length} nodes. Latest nodeId = ${lastNodeId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

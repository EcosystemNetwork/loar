/**
 * Build a canon episode for a universe from its existing offChainNodes
 * (or content docs with mediaType=ai-video). No fal/AI calls — purely
 * a Firestore wrap operation. Pattern matches commit 3364c0b7.
 *
 * Usage:
 *   pnpm tsx scripts/build-episode-from-nodes.ts <universeAddr> [--max 6]
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const universeAddr = (process.argv.find((a) => a.startsWith('0x')) || '').toLowerCase();
const maxIdx = process.argv.indexOf('--max');
const MAX_CLIPS = maxIdx !== -1 ? Number(process.argv[maxIdx + 1]) : 6;

if (!universeAddr) {
  console.error('Usage: pnpm tsx scripts/build-episode-from-nodes.ts <addr> [--max N]');
  process.exit(1);
}

async function main() {
  const existing = getApps()[0];
  let db;
  if (existing) {
    db = getFirestore(existing);
  } else {
    const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
    const app = initializeApp({ credential: cert(sa) });
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  const uDoc = await db.collection('cinematicUniverses').doc(universeAddr).get();
  if (!uDoc.exists) throw new Error(`universe ${universeAddr} not found`);
  const u = uDoc.data() as any;

  // Prefer offChainNodes (have nodeId + ordering); fall back to content docs.
  const ocSnap = await db.collection('offChainNodes').where('universeId', '==', universeAddr).get();
  const nodes = ocSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((n) => !!n.videoUrl)
    .sort((a, b) => (a.nodeId || 0) - (b.nodeId || 0));
  console.log(`Found ${nodes.length} offChainNodes with videoUrl.`);

  if (nodes.length === 0) {
    console.error('No usable offChainNodes — bail.');
    process.exit(1);
  }

  // Pick the first MAX_CLIPS in node order so the episode reads chronologically.
  const picked = nodes.slice(0, MAX_CLIPS);
  console.log(
    `Building ${picked.length}-clip episode from nodes ${picked.map((n) => n.nodeId).join(', ')}`
  );

  const episodeId = randomUUID();
  await db
    .collection('episodes')
    .doc(episodeId)
    .set({
      id: episodeId,
      universeId: universeAddr,
      title: `${u.name} — Pilot`,
      description: (u.description || '').slice(0, 200),
      isCanon: true,
      clipCount: picked.length,
      clips: picked.map((n, i) => ({
        nodeId: String(n.nodeId),
        label: n.label || `Part ${i + 1}`,
        videoUrl: n.videoUrl,
      })),
      sourceCreator: u.creator || null,
      createdAt: FieldValue.serverTimestamp(),
    });
  console.log(`✓ wrote episode ${episodeId} (isCanon=true, ${picked.length} clips)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

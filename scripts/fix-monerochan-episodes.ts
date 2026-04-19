/**
 * Fix Monerochan universe episodes:
 *
 *   - Rebuild the Animated episode (01b09a04) whose 20 clips all pointed to
 *     a single concatenated MP4. Replace with the 20 per-scene content docs
 *     tagged `episode-1-animated` (S01–S20, one unique mediaUrl each).
 *   - Delete the duplicate photoreal episode (34d07944, 18 clips, missing S08
 *     + S17). The complete 20-clip photoreal (f8000092) is the canonical real
 *     episode.
 *
 * Leaves exactly two episodes:
 *   f8000092  "Monerochan: Shadows of Freedom"           (photoreal, 20)
 *   01b09a04  "Monerochan: Shadows of Freedom (Animated)" (animated, 20)
 *
 *   DRY_RUN=1 pnpm tsx scripts/fix-monerochan-episodes.ts   # preview
 *   pnpm tsx scripts/fix-monerochan-episodes.ts             # apply
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9e1c8a49';
const PHOTOREAL_EPISODE_ID = 'f8000092-2800-42a2-948f-33466f5df683';
const ANIMATED_EPISODE_ID = '01b09a04-c0c5-4d0b-9506-d2f1485e8a46';
const DUPLICATE_PHOTOREAL_ID = '34d07944-deb0-4652-a4e3-8d7fedb0fde0';
const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, 'mc-fix-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  console.log(`\n=== Monerochan episodes fix (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===\n`);

  // ── 1. Gather the 20 animated scene content docs ────────────────────
  const animatedSnap = await db
    .collection('content')
    .where('universeId', '==', UNIVERSE_ID)
    .where('tags', 'array-contains', 'episode-1-animated')
    .get();

  type SceneDoc = {
    id: string;
    scene: string; // "S01"..."S20"
    title: string;
    mediaUrl: string;
  };
  const scenes: SceneDoc[] = [];
  for (const d of animatedSnap.docs) {
    const x = d.data() as any;
    const tags: string[] = x.tags ?? [];
    const sceneTag = tags.find((t) => /^s\d+$/i.test(t));
    if (!sceneTag) continue;
    const url = x.mediaUrl ?? x.videoUrl;
    if (!url) continue;
    scenes.push({
      id: d.id,
      scene: sceneTag.toUpperCase(),
      title: (x.title as string) ?? sceneTag.toUpperCase(),
      mediaUrl: url,
    });
  }
  scenes.sort((a, b) => a.scene.localeCompare(b.scene));

  if (scenes.length !== 20) {
    console.error(`  expected 20 animated scene docs, found ${scenes.length}`);
    process.exit(1);
  }

  // ── 2. Copy clip labels from the canonical photoreal episode ────────
  const photorealEp = await db.collection('episodes').doc(PHOTOREAL_EPISODE_ID).get();
  if (!photorealEp.exists) {
    console.error(`  photoreal episode ${PHOTOREAL_EPISODE_ID} not found`);
    process.exit(1);
  }
  const photorealClips: any[] = (photorealEp.data() as any).clips ?? [];
  const labelBySceneNum = new Map<number, string>();
  for (const c of photorealClips) {
    const m = /S(\d+)/i.exec(c.label ?? '');
    if (!m) continue;
    const n = parseInt(m[1], 10);
    // Strip the "Ep1 SXX: " prefix if present so the label reads cleanly
    const cleaned = (c.label as string).replace(
      /^S\d+:\s*Ep1\s*S\d+:\s*/i,
      `S${String(n).padStart(2, '0')}: `
    );
    labelBySceneNum.set(n, cleaned);
  }

  // ── 3. Build the new clips[] for the animated episode ───────────────
  const newClips = scenes.map((s) => {
    const n = parseInt(s.scene.slice(1), 10);
    const label = labelBySceneNum.get(n) ?? s.title;
    return {
      nodeId: s.id,
      label: label.slice(0, 200),
      videoUrl: s.mediaUrl,
      trimStart: 0,
      trimEnd: 0,
    };
  });

  console.log(`Rebuilt ${newClips.length} animated clips:`);
  for (const c of newClips) {
    console.log(`  ${c.label.padEnd(60)} ${c.videoUrl.slice(-50)}`);
  }

  // ── 4. Apply ────────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log(`\n[dry-run] would update ${ANIMATED_EPISODE_ID}.clips (${newClips.length} clips)`);
    console.log(`[dry-run] would delete duplicate ${DUPLICATE_PHOTOREAL_ID}`);
    process.exit(0);
  }

  await db
    .collection('episodes')
    .doc(ANIMATED_EPISODE_ID)
    .update({ clips: newClips, updatedAt: new Date() });
  console.log(`\n✓ Updated animated episode ${ANIMATED_EPISODE_ID} (${newClips.length} clips)`);

  await db.collection('episodes').doc(DUPLICATE_PHOTOREAL_ID).delete();
  console.log(`✓ Deleted duplicate photoreal ${DUPLICATE_PHOTOREAL_ID}`);

  // ── 5. Verify ───────────────────────────────────────────────────────
  const finalSnap = await db.collection('episodes').where('universeId', '==', UNIVERSE_ID).get();
  console.log(`\nFinal state: ${finalSnap.size} episode(s) for this universe`);
  for (const d of finalSnap.docs) {
    const x = d.data() as any;
    console.log(`  ${d.id}  "${x.title}"  clips=${Array.isArray(x.clips) ? x.clips.length : 0}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('FIX FAILED:', err);
  process.exit(1);
});

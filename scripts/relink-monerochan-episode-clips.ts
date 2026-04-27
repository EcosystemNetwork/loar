/**
 * Re-link the two Monerochan episode docs' clips[] to the universe's
 * offChainNodes by setting clip.nodeId to the matching integer node id.
 * Without this, watch.tsx can't collapse the offChainNodes into one card per
 * episode (it keys by `clip.nodeId` and the current values don't match):
 *
 *   - Realistic ep clips: nodeId 0..19  →  1..20  (offChainNodes 1..20)
 *   - Animated  ep clips: UUID strings  →  21..40 (offChainNodes 21..40)
 *
 * Clip videoUrls are NOT touched — the sequential /episode/$id player keeps
 * playing the same URLs. Only the integer linkage to offChainNodes changes.
 *
 *   pnpm tsx scripts/relink-monerochan-episode-clips.ts            (dry run)
 *   pnpm tsx scripts/relink-monerochan-episode-clips.ts --apply    (write)
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNIVERSE_ID = '0x0000000000000000000000000000019d9e1c8a49';

const TARGETS: Array<{
  id: string;
  style: 'realistic' | 'animated';
  ocNodeIdStart: number;
}> = [
  { id: 'f8000092-2800-42a2-948f-33466f5df683', style: 'realistic', ocNodeIdStart: 1 },
  { id: '01b09a04-c0c5-4d0b-9506-d2f1485e8a46', style: 'animated', ocNodeIdStart: 21 },
];

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'APPLY mode\n' : 'DRY RUN (pass --apply to write)\n');

  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, 'mc-relink-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  // Build offChainNode ordinal → label map so we can show the user the
  // alignment we're about to commit. Lets us catch ordering surprises before
  // mutating the docs.
  const ocSnap = await db.collection('offChainNodes').where('universeId', '==', UNIVERSE_ID).get();
  const ocByNid = new Map<number, string>();
  for (const d of ocSnap.docs) {
    const x = d.data() as any;
    ocByNid.set(x.nodeId, x.title ?? '');
  }

  for (const t of TARGETS) {
    const ref = db.collection('episodes').doc(t.id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`SKIP ${t.id} — not found`);
      continue;
    }
    const x = snap.data() as any;
    const clips: any[] = Array.isArray(x.clips) ? x.clips : [];
    console.log(`━━ ${t.id}  style=${t.style}  clips=${clips.length}`);

    const nextClips = clips.map((c, i) => {
      const newNid = t.ocNodeIdStart + i;
      return { ...c, nodeId: newNid };
    });

    let changed = 0;
    for (let i = 0; i < clips.length; i++) {
      const oldNid = clips[i].nodeId;
      const newNid = nextClips[i].nodeId;
      const ocLabel = ocByNid.get(newNid) ?? '(no offChainNode)';
      const willChange = String(oldNid) !== String(newNid);
      if (willChange) changed++;
      console.log(
        `  [${String(i + 1).padStart(2)}] ${willChange ? '~' : '='} clip.nodeId ${JSON.stringify(oldNid)} → ${newNid}   ocNode#${newNid}: ${ocLabel.slice(0, 50)}`
      );
    }
    console.log(`  → ${changed}/${clips.length} clip.nodeId values would change\n`);

    if (apply && changed > 0) {
      await ref.update({ clips: nextClips, updatedAt: new Date() });
      console.log(`  ✓ written\n`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

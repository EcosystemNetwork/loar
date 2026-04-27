/**
 * Find universes whose `name` collides with another universe's name; for
 * each collision, identify the side with NO content (no entities, no
 * generations, no content docs, no episodes, no offChainNodes); delete that
 * side's Firestore doc.
 *
 * Default: dry run.  Pass `--apply` to actually delete.
 *
 * Notes:
 *  - The on-chain Universe contract is not touched (we can't unwind a
 *    deploy). This only removes the Firestore mirror so the UI no longer
 *    shows the duplicate.
 *  - If both sides of a duplicate pair have content, neither is touched and
 *    a warning is printed.
 *  - Unnamed / null-name universes are skipped (they're handled separately).
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');

async function countContent(db: any, addr: string) {
  const lc = addr.toLowerCase();
  const [vg, ig, content, entities, episodes, offChain, attach] = await Promise.all([
    db.collection('videoGenerations').where('universeId', '==', lc).count().get(),
    db.collection('imageGenerations').where('universeId', '==', lc).count().get(),
    db.collection('content').where('universeId', '==', lc).count().get(),
    db.collection('entities').where('universeAddress', '==', lc).count().get(),
    db.collection('episodes').where('universeId', '==', lc).count().get(),
    db
      .collection('offChainNodes')
      .where('universeId', '==', lc)
      .count()
      .get()
      .catch(() => null),
    db.collection('mediaAttachments').where('universeId', '==', lc).count().get(),
  ]);
  return {
    videoGen: vg.data().count,
    imageGen: ig.data().count,
    content: content.data().count,
    entities: entities.data().count,
    episodes: episodes.data().count,
    offChainNodes: offChain ? offChain.data().count : 0,
    attachments: attach.data().count,
  };
}

function isEmpty(c: Record<string, number>): boolean {
  return Object.values(c).every((v) => v === 0);
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

  const uSnap = await db.collection('cinematicUniverses').get();
  const universes = uSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }));

  const byName = new Map<string, any[]>();
  for (const u of universes) {
    const name = (u.name || '').trim();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(u);
  }

  const dupGroups = [...byName.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`Found ${dupGroups.length} duplicate-name group(s):\n`);

  if (dupGroups.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let deleted = 0;
  let skipped = 0;
  for (const [name, group] of dupGroups) {
    console.log(`── "${name}" (${group.length} copies)`);
    const enriched = await Promise.all(
      group.map(async (u) => ({
        u,
        counts: await countContent(db, u.id),
      }))
    );

    for (const e of enriched) {
      const total = Object.values(e.counts).reduce((s: number, v: any) => s + (v as number), 0);
      console.log(
        `   ${e.u.id}  hidden=${!!e.u.isHidden}  totalAssets=${total}  ${JSON.stringify(e.counts)}`
      );
    }

    const empties = enriched.filter((e) => isEmpty(e.counts as Record<string, number>));
    const nonEmpties = enriched.filter((e) => !isEmpty(e.counts as Record<string, number>));

    if (nonEmpties.length === 0) {
      console.log(
        `   ⚠️  All ${group.length} copies are empty. Refusing to delete all of them — keeping the oldest.`
      );
      skipped++;
      continue;
    }

    if (empties.length === 0) {
      console.log(`   ⚠️  All copies have content. Manual review needed.`);
      skipped++;
      continue;
    }

    for (const e of empties) {
      console.log(`   🗑  ${APPLY ? 'DELETING' : 'WOULD DELETE'} empty copy: ${e.u.id}`);
      if (APPLY) {
        await e.u.ref.delete();
        deleted++;
      }
    }
  }

  console.log(
    `\n${APPLY ? 'Deleted' : 'Would delete'} ${deleted} doc(s). Skipped: ${skipped} group(s).`
  );
  if (!APPLY) console.log('Re-run with --apply to actually delete.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

/**
 * Repair Nexus Protocol media URLs pointing at the dead private Pinata gateway
 * (peach-impressive-moth-978.mypinata.cloud), which now 401s all
 * unauthenticated requests (ERR_ID:00024 — dedicated gateway access
 * restriction). Same root cause as scripts/fix-monerochan-dead-gateway-urls.ts,
 * confirmed for this universe by HEAD-checking every affected CID against
 * gateway.pinata.cloud before this script was written (all 200 OK).
 *
 * Rewrites every affected field to the public gateway equivalent and
 * archives the old URL alongside it for reversibility.
 *
 * Scope: episodes.clips[].videoUrl, content.mediaUrl/videoUrl,
 *        cinematicUniverses.image_url, entities.imageUrl — all scoped to
 *        the Nexus Protocol universe (0x0000...19d9ab4ae0f).
 *
 * NOT in scope: a handful of Nexus Protocol content docs whose videoUrl is a
 * temporary ByteDance/Volces TOS-signed URL (ark-acg-*.volces.com,
 * X-Tos-Expires=86400) generated 2026-04-17 — those expired 24h after
 * creation and were never persisted to permanent storage. No gateway swap
 * can fix them; they need regeneration (see scripts/generate-nexus-videos.ts).
 *
 * Usage:
 *   DRY_RUN=1 pnpm tsx scripts/fix-nexus-protocol-dead-gateway-urls.ts   # preview
 *   pnpm tsx scripts/fix-nexus-protocol-dead-gateway-urls.ts             # apply
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT_PATH  (default: ~/.config/loar/loar-db-sa.json)
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const DRY_RUN = process.env.DRY_RUN === '1';
const UNIVERSE_ID = '0x0000000000000000000000000000019d9ab4ae0f';
const DEAD_HOST = 'peach-impressive-moth-978.mypinata.cloud';
const PUBLIC_GATEWAY = 'https://gateway.pinata.cloud';

function rewrite(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.host !== DEAD_HOST) return null;
    return `${PUBLIC_GATEWAY}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

interface Change {
  coll: string;
  id: string;
  field: string;
  oldUrl: string;
  newUrl: string;
}

async function main() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? `${process.env.HOME}/.config/loar/loar-db-sa.json`
  );
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, `nexus-gw-fix-${Date.now()}`);
  const db: Firestore = getFirestore(app);
  db.settings({ preferRest: true });

  console.log(
    `\n=== Nexus Protocol dead-gateway URL repair (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===\n`
  );

  const changes: Change[] = [];
  const writes: Array<() => Promise<void>> = [];

  // ── 1. episodes.clips[].videoUrl ─────────────────────────────────────
  const epSnap = await db.collection('episodes').where('universeId', '==', UNIVERSE_ID).get();
  for (const doc of epSnap.docs) {
    const x = doc.data() as any;
    const clips: any[] = Array.isArray(x.clips) ? x.clips : [];
    let touched = false;
    const newClips = clips.map((c) => {
      const nu = c.videoUrl ? rewrite(c.videoUrl) : null;
      if (!nu) return c;
      touched = true;
      changes.push({
        coll: 'episodes',
        id: doc.id,
        field: `clips[].videoUrl (${c.label ?? ''})`,
        oldUrl: c.videoUrl,
        newUrl: nu,
      });
      return { ...c, videoUrl: nu };
    });
    if (touched) {
      writes.push(() => doc.ref.update({ clips: newClips, updatedAt: new Date() }));
    }
  }

  // ── 2. content.mediaUrl / videoUrl ───────────────────────────────────
  const contentSnap = await db.collection('content').where('universeId', '==', UNIVERSE_ID).get();
  for (const doc of contentSnap.docs) {
    const x = doc.data() as any;
    const update: Record<string, unknown> = {};
    for (const field of ['mediaUrl', 'videoUrl', 'thumbnailUrl']) {
      const v = x[field];
      if (typeof v !== 'string') continue;
      const nu = rewrite(v);
      if (!nu) continue;
      changes.push({ coll: 'content', id: doc.id, field, oldUrl: v, newUrl: nu });
      update[field] = nu;
      update[`${field}Archived`] = v;
    }
    if (Object.keys(update).length > 0) {
      update.mediaUrlRepairedAt = new Date();
      update.mediaUrlRepairedReason = 'dead_dedicated_pinata_gateway_401_rewritten_to_public';
      writes.push(() => doc.ref.update(update));
    }
  }

  // ── 3. cinematicUniverses.image_url ──────────────────────────────────
  const uDoc = await db.collection('cinematicUniverses').doc(UNIVERSE_ID).get();
  {
    const x = uDoc.data() as any;
    const nu = x?.image_url ? rewrite(x.image_url) : null;
    if (nu) {
      changes.push({
        coll: 'cinematicUniverses',
        id: uDoc.id,
        field: 'image_url',
        oldUrl: x.image_url,
        newUrl: nu,
      });
      writes.push(() =>
        uDoc.ref.update({
          image_url: nu,
          image_url_archived: x.image_url,
          updated_at: new Date(),
        })
      );
    }
  }

  // ── 4. entities.imageUrl ─────────────────────────────────────────────
  const entSnap = await db.collection('entities').where('universeAddress', '==', UNIVERSE_ID).get();
  for (const doc of entSnap.docs) {
    const x = doc.data() as any;
    const nu = x.imageUrl ? rewrite(x.imageUrl) : null;
    if (!nu) continue;
    changes.push({
      coll: 'entities',
      id: doc.id,
      field: `imageUrl (${x.name ?? ''})`,
      oldUrl: x.imageUrl,
      newUrl: nu,
    });
    writes.push(() =>
      doc.ref.update({
        imageUrl: nu,
        imageUrlArchived: x.imageUrl,
        updatedAt: new Date(),
      })
    );
  }

  console.log(`Found ${changes.length} field(s) to repair across ${writes.length} doc(s):\n`);
  const byColl: Record<string, number> = {};
  for (const c of changes) byColl[c.coll] = (byColl[c.coll] ?? 0) + 1;
  for (const [coll, n] of Object.entries(byColl)) console.log(`  ${coll}: ${n}`);

  if (DRY_RUN) {
    console.log(`\n=== SAMPLE (first 8) ===`);
    for (const c of changes.slice(0, 8)) {
      console.log(`  [${c.coll}/${c.id}] ${c.field}`);
      console.log(`    old: ${c.oldUrl}`);
      console.log(`    new: ${c.newUrl}`);
    }
    console.log(`\n(DRY_RUN — no writes performed.)`);
    process.exit(0);
  }

  // Backup manifest before writing anything.
  const backupPath = path.resolve(
    process.cwd(),
    `repair-nexus-protocol-gateway-urls-${Date.now()}.json`
  );
  fs.writeFileSync(backupPath, JSON.stringify({ changes }, null, 2));
  console.log(`\nBackup manifest written: ${backupPath}`);

  console.log(`\nApplying ${writes.length} doc update(s)...`);
  let done = 0;
  for (const w of writes) {
    await w();
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${writes.length}`);
  }
  console.log(`  ${done}/${writes.length} applied`);
  console.log(`\nDone.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('REPAIR FAILED:', err);
  process.exit(1);
});

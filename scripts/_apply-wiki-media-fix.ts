/**
 * One-off: fix the two remaining live-but-broken media refs found in the
 * wiki-media audit (2026-09-01). The other 122 dead ephemeral content docs
 * are already contentStatus='hidden' from a prior repair run.
 *
 *   1. content/X5fJ6WRAPA2dLoQBuItI  — active+public ai-video whose mediaUrl is
 *      an expired Google Veo Files API URL, no generations doc to rescue from.
 *      -> contentStatus='hidden' (reversible).
 *   2. entity/DtO2gu69Fx4OOWKLZQTe  — metadata.characterVariants[0].imageUrl is
 *      an expired v3b.fal.media URL. Top-level imageUrl is a good pinned CID.
 *      -> repoint the variant image to the entity's pinned imageUrl.
 *
 * DRY_RUN=1 to preview.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
delete process.env.FIRESTORE_EMULATOR_HOST;

const DRY = process.env.DRY_RUN === '1';
const sa = JSON.parse(readFileSync(`${process.env.HOME}/.config/loar/loar-db-sa.json`, 'utf-8'));
const db = getFirestore(
  initializeApp({ credential: cert(sa), projectId: 'loar-db' }, 'fix' + Date.now())
);
db.settings({ preferRest: true });

(async () => {
  const backup: any = { ts: Date.now() };

  // 1. content doc
  const cRef = db.collection('content').doc('X5fJ6WRAPA2dLoQBuItI');
  const cSnap = await cRef.get();
  backup.content = cSnap.data();
  const cPatch = {
    contentStatus: 'hidden',
    contentStatusUpdatedAt: new Date(),
    contentStatusUpdatedBy: 'wiki-media-audit-2026-09',
    contentStatusReason: 'ephemeral_veo_url_expired_no_rescue',
    brokenMediaUrlArchived: cSnap.get('mediaUrl'),
  };
  console.log('content/X5fJ6WRAPA2dLoQBuItI  ->', JSON.stringify(cPatch));

  // 2. entity doc
  const eRef = db.collection('entities').doc('DtO2gu69Fx4OOWKLZQTe');
  const eSnap = await eRef.get();
  const e = eSnap.data()!;
  backup.entity = e;
  const pinned = e.imageUrl as string;
  const variants = (e.metadata?.characterVariants ?? []).map((v: any) => ({
    ...v,
    imageUrl:
      typeof v.imageUrl === 'string' && v.imageUrl.includes('fal.media') ? pinned : v.imageUrl,
    brokenImageUrlArchived:
      typeof v.imageUrl === 'string' && v.imageUrl.includes('fal.media') ? v.imageUrl : undefined,
  }));
  const ePatch = {
    metadata: { ...e.metadata, characterVariants: variants },
    updatedAt: new Date(),
  };
  console.log('entity/DtO2gu69Fx4OOWKLZQTe variants ->', JSON.stringify(variants));

  const manifestPath = path.join(
    '/tmp/claude-1000/-home-god-Desktop-loar-loar/40ab99ba-32fd-49f0-bdaf-c51183b76f39/scratchpad',
    `wiki-media-fix-backup-${backup.ts}.json`
  );
  writeFileSync(manifestPath, JSON.stringify(backup, null, 2));
  console.log('\nbackup manifest:', manifestPath);

  if (DRY) {
    console.log('\n(DRY_RUN — no writes)');
    process.exit(0);
  }
  await cRef.update(cPatch);
  await eRef.update(ePatch);
  console.log('\napplied.');
  process.exit(0);
})();

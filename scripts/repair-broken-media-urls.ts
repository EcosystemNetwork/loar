/**
 * Repair broken ephemeral media URLs in Firestore `content` docs.
 *
 * Two repair modes:
 *   1. Re-point: if the doc's `generationId` has a matching `generations` doc
 *      with `permanentVideoUrl`, update `content.mediaUrl` to point there.
 *   2. Hide: if no permanent URL exists, set `contentStatus='hidden'` so the
 *      gallery stops surfacing a dead link. Reversible via `contentStatus='active'`.
 *
 * Usage:
 *   DRY_RUN=1 pnpm tsx scripts/repair-broken-media-urls.ts
 *   pnpm tsx scripts/repair-broken-media-urls.ts
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT_PATH  (default: firebase-sa-key-20260416.json)
 *   DRY_RUN=1                      survey + classify only, no writes
 *   REPAIR_CONCURRENCY             parallel HEAD checks + updates (default 8)
 *
 * Ephemeral-host detection mirrors `apps/server/src/lib/gallery-publish.ts`.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DRY_RUN = process.env.DRY_RUN === '1';
const CONCURRENCY = Math.max(1, parseInt(process.env.REPAIR_CONCURRENCY ?? '8', 10));
const EPHEMERAL_PATTERNS = [
  'volces.com',
  'fal.media',
  'replicate.delivery',
  'oaidalleapiprodscus.blob.core.windows.net',
  'ark-acg',
];
const MEDIA_URL_FIELDS = ['mediaUrl', 'videoUrl', 'audioUrl', 'imageUrl', 'thumbnailUrl'];

interface CheckResult {
  docId: string;
  field: string;
  brokenUrl: string;
  generationId: string | null;
  permanentUrl: string | null;
  action: 'repoint' | 'hide' | 'skip';
}

function isEphemeralUrl(url: string): boolean {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return EPHEMERAL_PATTERNS.some((ep) => host.includes(ep));
  } catch {
    return false;
  }
}

async function headOk(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const r = await fetch(url, { method: 'HEAD', signal: c.signal, redirect: 'manual' });
    clearTimeout(t);
    return r.status >= 200 && r.status < 400;
  } catch {
    return false;
  }
}

async function main() {
  const sa = JSON.parse(
    fs.readFileSync(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ??
        '/home/god/Desktop/LOAR/loar/firebase-sa-key-20260416.json',
      'utf-8'
    )
  );
  const app = initializeApp({ credential: cert(sa) }, `repair-${Date.now()}`);
  const db: Firestore = getFirestore(app);
  db.settings({ preferRest: true });

  console.log(`\n=== REPAIR BROKEN MEDIA URLS (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===\n`);

  // 1. Scan content collection for docs pointing to ephemeral hosts.
  const snap = await db.collection('content').get();
  const ephemeralDocs: Array<{ docId: string; field: string; url: string; data: any }> = [];
  for (const d of snap.docs) {
    const data = d.data();
    for (const f of MEDIA_URL_FIELDS) {
      const v = data[f];
      if (typeof v === 'string' && isEphemeralUrl(v)) {
        ephemeralDocs.push({ docId: d.id, field: f, url: v, data });
      }
    }
  }
  console.log(
    `Scanned ${snap.size} content docs — ${ephemeralDocs.length} reference an ephemeral host`
  );

  // 2. Verify each is actually broken via HEAD (skip live ones).
  console.log(`\nHEAD-checking each (concurrency=${CONCURRENCY})…`);
  const brokenDocs: typeof ephemeralDocs = [];
  let cursor = 0;
  async function headWorker() {
    while (cursor < ephemeralDocs.length) {
      const i = cursor++;
      const row = ephemeralDocs[i];
      const ok = await headOk(row.url);
      if (!ok) brokenDocs.push(row);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => headWorker()));
  console.log(
    `  ${brokenDocs.length}/${ephemeralDocs.length} confirmed broken, ${ephemeralDocs.length - brokenDocs.length} still live (leaving alone)`
  );

  // 3. For each broken doc, look for a permanent URL in the matching generations doc.
  console.log(`\nLooking for rescue URLs in generations/…`);
  const results: CheckResult[] = [];
  for (const row of brokenDocs) {
    const generationId = (row.data.generationId as string) ?? null;
    let permanent: string | null = null;
    if (generationId) {
      try {
        const gen = await db.collection('generations').doc(generationId).get();
        if (gen.exists) {
          const gd = gen.data()!;
          permanent =
            (gd.permanentVideoUrl as string) ??
            (gd.permanentImageUrl as string) ??
            (gd.permanentMediaUrl as string) ??
            null;
          if (permanent && isEphemeralUrl(permanent)) permanent = null;
        }
      } catch (err) {
        console.error(`  generations/${generationId} lookup failed:`, err);
      }
    }
    results.push({
      docId: row.docId,
      field: row.field,
      brokenUrl: row.url,
      generationId,
      permanentUrl: permanent,
      action: permanent ? 'repoint' : 'hide',
    });
  }

  const repointable = results.filter((r) => r.action === 'repoint');
  const hideable = results.filter((r) => r.action === 'hide');
  console.log(`  Rescue URL found (repoint): ${repointable.length}`);
  console.log(`  No rescue (hide):           ${hideable.length}`);

  if (DRY_RUN) {
    console.log(`\n=== SAMPLE ACTIONS ===`);
    console.log(`\nREPOINT (first 5):`);
    for (const r of repointable.slice(0, 5)) {
      console.log(`  ${r.docId}  ${r.field}`);
      console.log(`    old: ${r.brokenUrl.slice(0, 80)}`);
      console.log(`    new: ${r.permanentUrl!.slice(0, 80)}`);
    }
    console.log(`\nHIDE (first 5):`);
    for (const r of hideable.slice(0, 5)) {
      console.log(`  ${r.docId}  ${r.field}  (generationId=${r.generationId ?? 'none'})`);
    }
    console.log(`\n(DRY_RUN — no writes performed.)`);
    return;
  }

  // 4. Apply changes.
  console.log(`\nApplying ${repointable.length} repoints + ${hideable.length} hides…`);
  let done = 0;
  for (const r of repointable) {
    try {
      await db
        .collection('content')
        .doc(r.docId)
        .update({
          [r.field]: r.permanentUrl,
          brokenMediaUrlArchived: r.brokenUrl,
          mediaUrlRepairedAt: new Date(),
          mediaUrlRepairedReason: 'ephemeral_url_expired_rescued_from_generations',
        });
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${repointable.length} repointed`);
    } catch (err) {
      console.error(`  repoint ${r.docId} failed:`, err);
    }
  }
  console.log(`  ${done}/${repointable.length} repoints applied`);

  done = 0;
  for (const r of hideable) {
    try {
      await db.collection('content').doc(r.docId).update({
        contentStatus: 'hidden',
        contentStatusUpdatedAt: new Date(),
        contentStatusUpdatedBy: 'repair-broken-media-urls',
        contentStatusReason: 'ephemeral_url_expired_no_rescue_available',
        brokenMediaUrlArchived: r.brokenUrl,
      });
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${hideable.length} hidden`);
    } catch (err) {
      console.error(`  hide ${r.docId} failed:`, err);
    }
  }
  console.log(`  ${done}/${hideable.length} hides applied`);

  // 5. Write a backup manifest so the operation is reversible.
  const backupPath = path.resolve(process.cwd(), `repair-broken-urls-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ results }, null, 2));
  console.log(`\nBackup manifest: ${backupPath}`);
  console.log(`\nDone. Gallery UI should stop showing dead refs after its next query.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('REPAIR FAILED:', err);
    process.exit(1);
  });

/**
 * Fix legacy direct-GCS hero-video URLs that 403 in the browser.
 *
 * Some older `content` docs store a raw `https://storage.googleapis.com/<bucket>/...`
 * URL (pre-dates the tokenized-download-URL scheme in
 * `apps/server/src/services/firebase-storage.ts`). Those objects were never
 * granted public-read, so a direct browser fetch 403s (CSP already allows the
 * host — this is an object-ACL problem, not a policy problem).
 *
 * Fix: set the same `firebaseStorageDownloadTokens` custom metadata on the
 * GCS object that `StorageService.upload()` sets for new uploads, then
 * rewrite the Firestore doc to the tokenized `firebasestorage.googleapis.com`
 * URL — matching `StorageService.getPublicUrl()` exactly. No bucket/object
 * ACL changes, consistent with the existing "no public objects" hardening.
 *
 * If the underlying GCS object no longer exists at all (not an ACL problem —
 * genuinely deleted/never landed), there's nothing to re-point to since no
 * matching `generations` doc has a permanent URL either. Falls back to the
 * same "hide" behavior as `repair-broken-media-urls.ts`: set
 * `contentStatus: 'hidden'` so the gallery/landing page stops surfacing the
 * dead link. Reversible via `contentStatus: 'active'`.
 *
 * Usage:
 *   DRY_RUN=1 pnpm tsx scripts/fix-hero-video-403s.ts
 *   pnpm tsx scripts/fix-hero-video-403s.ts
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT_PATH   (default: firebase-sa-key-20260416.json)
 *   FIREBASE_STORAGE_BUCKET         (default: <project_id from SA key>.firebasestorage.app)
 *   FIREBASE_STORAGE_TOKEN_SECRET / SIWE_JWT_SECRET   HMAC secret for the download token
 *     — must match what the running server uses, or generated links won't verify.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createHmac } from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DRY_RUN = process.env.DRY_RUN === '1';
const MEDIA_URL_FIELDS = ['mediaUrl', 'videoUrl', 'audioUrl', 'imageUrl', 'thumbnailUrl'];

function downloadToken(bucketName: string, key: string): string {
  const secret = process.env.FIREBASE_STORAGE_TOKEN_SECRET || process.env.SIWE_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('FIREBASE_STORAGE_TOKEN_SECRET must contain at least 32 characters');
  }
  return createHmac('sha256', secret).update(`${bucketName}:${key}`).digest('hex');
}

/** Extract the GCS object key from a direct storage.googleapis.com URL for our bucket. */
function extractKey(url: string, bucketName: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'storage.googleapis.com') return null;
    const prefix = `/${bucketName}/`;
    if (!u.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(u.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

async function main() {
  const saPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ??
    '/home/god/Desktop/LOAR/loar/firebase-sa-key-20260416.json';
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${sa.project_id}.firebasestorage.app`;

  const app = initializeApp(
    { credential: cert(sa), storageBucket: bucketName },
    `fix-hero-${Date.now()}`
  );
  const db: Firestore = getFirestore(app);
  db.settings({ preferRest: true });
  const bucket = getStorage(app).bucket(bucketName);

  console.log(
    `\n=== FIX HERO VIDEO 403s (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) — bucket: ${bucketName} ===\n`
  );

  const snap = await db.collection('content').get();
  const hits: Array<{ docId: string; field: string; url: string; key: string }> = [];
  for (const d of snap.docs) {
    const data = d.data();
    for (const f of MEDIA_URL_FIELDS) {
      const v = data[f];
      if (typeof v !== 'string') continue;
      const key = extractKey(v, bucketName);
      if (key) hits.push({ docId: d.id, field: f, url: v, key });
    }
  }

  console.log(
    `Scanned ${snap.size} content docs — ${hits.length} field(s) use a raw storage.googleapis.com URL\n`
  );

  let fixed = 0;
  let hidden = 0;
  let failed = 0;
  const hiddenDocIds = new Set<string>();

  for (const h of hits) {
    const file = bucket.file(h.key);
    const [exists] = await file.exists().catch(() => [false]);
    if (!exists) {
      if (hiddenDocIds.has(h.docId)) continue; // already handled via another field on this doc
      console.log(
        `  [HIDE] ${h.docId} (${h.field}) — object gone, no permanent URL to re-point to: ${h.key}`
      );
      hiddenDocIds.add(h.docId);
      if (!DRY_RUN) {
        try {
          await db
            .collection('content')
            .doc(h.docId)
            .update({ contentStatus: 'hidden', hiddenReason: 'dead-gcs-object' });
          hidden++;
        } catch (err) {
          console.log(`        ERROR: ${(err as Error).message}`);
          failed++;
        }
      } else {
        hidden++;
      }
      continue;
    }

    const token = downloadToken(bucketName, h.key);
    const newUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(h.key)}?alt=media&token=${token}`;

    console.log(`  [FIX] ${h.docId}.${h.field}`);
    console.log(`        key:  ${h.key}`);
    console.log(`        old:  ${h.url}`);
    console.log(`        new:  ${newUrl}`);

    if (!DRY_RUN) {
      try {
        await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
        await db
          .collection('content')
          .doc(h.docId)
          .update({ [h.field]: newUrl });
        fixed++;
      } catch (err) {
        console.log(`        ERROR: ${(err as Error).message}`);
        failed++;
      }
    }
  }

  console.log(
    `\n=== DONE — ${fixed} URL(s) re-tokenized, ${hidden} doc(s) ${DRY_RUN ? 'would be hidden' : 'hidden'}, ${failed} failed ===\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

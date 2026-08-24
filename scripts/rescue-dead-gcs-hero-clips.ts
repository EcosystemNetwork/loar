/**
 * Rescue script for the legacy `storage.googleapis.com/{bucket}/videos/...`
 * URLs found by scripts/scan-dead-gcs-storage-urls.ts.
 *
 * The 403s are an ACL problem, not a deleted-object problem: the object
 * bytes almost certainly still sit in the bucket at their legacy key —
 * Firebase Admin credentials read via IAM, not the object's public-read
 * setting, so they bypass the 403 entirely. This script:
 *
 *   1. Re-scans content/episodes/offChainNodes for the dead URL pattern.
 *   2. For each unique broken URL, admin-downloads the bytes straight out
 *      of GCS (bucket.file(key).download() — ignores public ACL).
 *   3. Pins those bytes to Pinata IPFS — the permanent-URL convention this
 *      codebase already uses for hero clips (scripts/regen-hero-clip.ts).
 *   4. Updates every doc/field that referenced the old URL to the new
 *      Pinata gateway URL, and archives the old URL on the doc for
 *      reversibility (same convention as repair-broken-media-urls.ts).
 *   5. Writes a before/after backup manifest.
 *
 * Anything whose GCS object is genuinely gone (not just ACL-locked) is
 * reported as unrecoverable — nothing is silently skipped or guessed at.
 *
 * Usage:
 *   DRY_RUN=1 pnpm tsx scripts/rescue-dead-gcs-hero-clips.ts   # probe + pin, no Firestore writes
 *   pnpm tsx scripts/rescue-dead-gcs-hero-clips.ts             # live: download, pin, update Firestore
 *
 * Env: FIREBASE_SERVICE_ACCOUNT_PATH (default firebase-sa-key-20260416.json),
 *      PINATA_JWT, PINATA_GATEWAY_URL (optional, defaults to public gateway)
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DRY_RUN = process.env.DRY_RUN === '1';
const DEAD_HOST = 'storage.googleapis.com';
const PINATA_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

function assertProdSafe(keyPath: string) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(
      `\nRefusing to run: FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST} is set. ` +
        `Unset it — this must run against production.\n`
    );
    process.exit(1);
  }
  if (/emulator|local/i.test(keyPath)) {
    console.error(`\nRefusing to run: "${keyPath}" looks like a local/emulator key, not prod.\n`);
    process.exit(1);
  }
}

function findDeadUrls(
  value: unknown,
  fieldPath: string,
  out: Array<{ field: string; url: string }>
) {
  if (typeof value === 'string') {
    if (value.includes(DEAD_HOST)) out.push({ field: fieldPath, url: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => findDeadUrls(v, `${fieldPath}[${i}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' || Array.isArray(v)) findDeadUrls(v, `${fieldPath}.${k}`, out);
    }
  }
}

interface Hit {
  collection: 'content' | 'episodes' | 'offChainNodes';
  docId: string;
  field: string;
  url: string;
}

/** Parse `https://storage.googleapis.com/{bucket}/{key...}` into parts. */
function parseGcsUrl(url: string): { bucket: string; key: string } | null {
  try {
    const u = new URL(url);
    if (u.host !== DEAD_HOST) return null;
    const parts = u.pathname.replace(/^\//, '').split('/');
    const bucket = parts.shift();
    const key = decodeURIComponent(parts.join('/'));
    if (!bucket || !key) return null;
    return { bucket, key };
  } catch {
    return null;
  }
}

async function pinBufferToPinata(
  buffer: Buffer,
  filename: string,
  pinName: string
): Promise<{ url: string; cid: string }> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not set — cannot pin rescued content');

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'video/mp4' }), filename);
  form.append('pinataMetadata', JSON.stringify({ name: pinName }));

  const res = await fetch(PINATA_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pinata pin failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  const gateway = (process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud').replace(
    /\/$/,
    ''
  );
  return { url: `${gateway}/ipfs/${IpfsHash}`, cid: IpfsHash };
}

async function main() {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json';
  assertProdSafe(keyPath);

  const sa = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, `rescue-${Date.now()}`);
  const db: Firestore = getFirestore(app);
  db.settings({ preferRest: true });

  console.log(`\n=== RESCUE: dead ${DEAD_HOST} hero clips (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===\n`);

  // 1. Re-scan for current hits (don't trust a stale report file).
  const hits: Hit[] = [];
  const contentSnap = await db.collection('content').get();
  for (const d of contentSnap.docs) {
    const found: Array<{ field: string; url: string }> = [];
    const data = d.data();
    for (const f of ['mediaUrl', 'thumbnailUrl', 'imageUrl', 'videoUrl', 'audioUrl']) {
      findDeadUrls(data[f], f, found);
    }
    for (const { field, url } of found)
      hits.push({ collection: 'content', docId: d.id, field, url });
  }
  const episodesSnap = await db.collection('episodes').get();
  for (const d of episodesSnap.docs) {
    const found: Array<{ field: string; url: string }> = [];
    const data = d.data();
    findDeadUrls(data.clips, 'clips', found);
    for (const f of ['videoUrl', 'thumbnailUrl', 'coverImageUrl']) findDeadUrls(data[f], f, found);
    for (const { field, url } of found)
      hits.push({ collection: 'episodes', docId: d.id, field, url });
  }
  const offChainSnap = await db.collection('offChainNodes').get();
  for (const d of offChainSnap.docs) {
    const found: Array<{ field: string; url: string }> = [];
    const data = d.data();
    for (const f of ['videoUrl', 'thumbnailUrl', 'imageUrl']) findDeadUrls(data[f], f, found);
    for (const { field, url } of found)
      hits.push({ collection: 'offChainNodes', docId: d.id, field, url });
  }

  const uniqueUrls = Array.from(new Set(hits.map((h) => h.url)));
  console.log(`${hits.length} field(s) across ${uniqueUrls.length} unique broken URL(s)\n`);

  // 2. Rescue each unique URL once: admin-download + pin.
  const rescued = new Map<string, { newUrl: string; cid: string; bytes: number }>();
  const unrecoverable: string[] = [];

  for (const url of uniqueUrls) {
    const parsed = parseGcsUrl(url);
    if (!parsed) {
      console.log(`  SKIP (unparseable): ${url}`);
      unrecoverable.push(url);
      continue;
    }
    const file = getStorage(app).bucket(parsed.bucket).file(parsed.key);
    const [exists] = await file.exists();
    if (!exists) {
      console.log(`  UNRECOVERABLE (object gone): ${parsed.key}`);
      unrecoverable.push(url);
      continue;
    }

    process.stdout.write(`  downloading ${parsed.key}… `);
    const [buffer] = await file.download();
    console.log(`${(buffer.length / 1024 / 1024).toFixed(1)}MB`);

    if (DRY_RUN) {
      console.log(`    (dry-run — skipping pin + Firestore update)`);
      continue;
    }

    const basename = parsed.key.split('/').pop() || 'rescued-video.mp4';
    const displayName = basename.replace(/_mp4$/i, '.mp4');
    process.stdout.write(`    pinning to IPFS… `);
    const pinned = await pinBufferToPinata(buffer, displayName, displayName);
    console.log(`cid=${pinned.cid}`);
    rescued.set(url, { newUrl: pinned.url, cid: pinned.cid, bytes: buffer.length });
  }

  if (DRY_RUN) {
    console.log(`\n(DRY_RUN — no Pinata pins committed as new content, no Firestore writes.)`);
    return;
  }

  // 3. Apply Firestore updates for every hit whose URL was rescued.
  console.log(`\nUpdating Firestore (${rescued.size}/${uniqueUrls.length} URLs rescued)…`);
  const manifest: any[] = [];

  for (const h of hits) {
    const r = rescued.get(h.url);
    if (!r) continue; // unrecoverable — left untouched, reported below

    if (h.collection === 'content' || h.collection === 'offChainNodes') {
      await db
        .collection(h.collection)
        .doc(h.docId)
        .update({
          [h.field]: r.newUrl,
          brokenMediaUrlArchived: h.url,
          mediaUrlRepairedAt: new Date(),
          mediaUrlRepairedReason: 'legacy_gcs_url_403_rescued_via_admin_download_and_pinata',
        });
    } else if (h.collection === 'episodes' && h.field.startsWith('clips[')) {
      const idx = Number(h.field.match(/^clips\[(\d+)\]/)?.[1]);
      const doc = await db.collection('episodes').doc(h.docId).get();
      const clips = (doc.data()?.clips ?? []) as any[];
      if (clips[idx]) {
        clips[idx] = { ...clips[idx], videoUrl: r.newUrl };
        await db.collection('episodes').doc(h.docId).update({
          clips,
          brokenMediaUrlArchived: h.url,
          mediaUrlRepairedAt: new Date(),
          mediaUrlRepairedReason: 'legacy_gcs_url_403_rescued_via_admin_download_and_pinata',
        });
      }
    } else {
      await db
        .collection(h.collection)
        .doc(h.docId)
        .update({
          [h.field]: r.newUrl,
          brokenMediaUrlArchived: h.url,
          mediaUrlRepairedAt: new Date(),
          mediaUrlRepairedReason: 'legacy_gcs_url_403_rescued_via_admin_download_and_pinata',
        });
    }

    manifest.push({ ...h, newUrl: r.newUrl, cid: r.cid });
    console.log(`  [${h.collection}] ${h.docId}.${h.field} → ${r.newUrl}`);
  }

  console.log(`\n══════ SUMMARY ══════`);
  console.log(`Rescued:       ${rescued.size} unique file(s), ${manifest.length} field(s) updated`);
  console.log(`Unrecoverable: ${unrecoverable.length}`);
  if (unrecoverable.length > 0) {
    console.log(`  (object no longer exists in the bucket — these need regeneration, not rescue)`);
    unrecoverable.forEach((u) => console.log(`  - ${u}`));
  }

  const backupPath = path.resolve(process.cwd(), `rescue-gcs-hero-clips-${Date.now()}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ rescuedAt: new Date().toISOString(), manifest, unrecoverable }, null, 2)
  );
  console.log(`\nBackup manifest: ${backupPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('RESCUE FAILED:', err);
    process.exit(1);
  });

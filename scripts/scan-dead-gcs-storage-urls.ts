/**
 * Read-only scan for content docs pointing at the legacy, non-token-gated
 * GCS URL scheme: `https://storage.googleapis.com/{bucket}/videos/{file}`.
 *
 * Why this exists: `apps/server/src/services/firebase-storage.ts` used to
 * write uploads under a `videos/` prefix and hand back a raw
 * `storage.googleapis.com/...` URL. It now writes to `objects/{hash}` and
 * only ever returns the token-gated `firebasestorage.googleapis.com/v0/b/...
 * ?alt=media&token=...` form (see `getPublicUrl()`). Any doc still holding
 * the old raw URL 403s the moment the bucket's default object ACL stopped
 * allowing anonymous reads — which is exactly what's showing up in
 * production console logs right now.
 *
 * `scripts/repair-broken-media-urls.ts` already exists for this class of
 * problem, but its `EPHEMERAL_PATTERNS` allowlist does not include
 * `storage.googleapis.com` — so these docs are invisible to it. This script
 * does NOT write anything; it just finds and reports them (across a wider
 * set of collections than the `content`-only repair script covers) so the
 * blast radius is known before anyone decides how to repair it.
 *
 * Usage:
 *   pnpm tsx scripts/scan-dead-gcs-storage-urls.ts              # scan + report
 *   pnpm tsx scripts/scan-dead-gcs-storage-urls.ts --verify     # also HEAD-check each hit
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT_PATH   service account key (default: firebase-sa-key-20260416.json)
 *   SCAN_CONCURRENCY                parallel HEAD checks when --verify is passed (default 8)
 *
 * Safety: refuses to run if FIRESTORE_EMULATOR_HOST is set, or if the
 * resolved service-account key path looks like a local/emulator placeholder
 * — both would silently scan the (empty) emulator instead of production and
 * report a false "nothing broken."
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const VERIFY = process.argv.includes('--verify');
const CONCURRENCY = Math.max(1, parseInt(process.env.SCAN_CONCURRENCY ?? '8', 10));

// The dead scheme: any storage.googleapis.com URL. (The current, working
// scheme is firebasestorage.googleapis.com/v0/b/.../o/...?alt=media&token=
// — a different host — so this pattern alone is unambiguous.)
const DEAD_HOST = 'storage.googleapis.com';

interface Hit {
  collection: string;
  docId: string;
  field: string;
  url: string;
  universeId?: string;
  reachable?: boolean;
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
    // One level of nesting is enough for the shapes we actually store
    // (metadata blobs, clip arrays) without walking into unrelated objects.
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' || Array.isArray(v)) findDeadUrls(v, `${fieldPath}.${k}`, out);
    }
  }
}

async function headOk(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const r = await fetch(url, { method: 'HEAD', signal: c.signal, redirect: 'follow' });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

function assertProdSafe(keyPath: string) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(
      `\nRefusing to run: FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST} is set.\n` +
        `This would scan the local emulator (almost certainly empty) and report a false ` +
        `"nothing broken" instead of scanning production.\nUnset it and re-run, e.g.:\n` +
        `  env -u FIRESTORE_EMULATOR_HOST pnpm tsx scripts/scan-dead-gcs-storage-urls.ts\n`
    );
    process.exit(1);
  }
  if (/emulator|local/i.test(keyPath)) {
    console.error(
      `\nRefusing to run: service account key path "${keyPath}" looks like a local/emulator ` +
        `placeholder, not a real production credential.\nSet FIREBASE_SERVICE_ACCOUNT_PATH to ` +
        `the production key file and re-run.\n`
    );
    process.exit(1);
  }
}

async function main() {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json';
  assertProdSafe(keyPath);

  const sa = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, `scan-${Date.now()}`);
  const db: Firestore = getFirestore(app);
  db.settings({ preferRest: true });

  console.log(
    `\n=== SCAN: dead ${DEAD_HOST} URLs (read-only${VERIFY ? ', with HEAD verify' : ''}) ===\n`
  );

  const hits: Hit[] = [];

  // `content` — the gallery, and where scripts/regen-hero-clip.ts writes
  // mediaUrl/thumbnailUrl for hero clips (matches the console errors' shape:
  // hero-<Universe-Name>.mp4).
  const contentSnap = await db.collection('content').get();
  for (const d of contentSnap.docs) {
    const found: Array<{ field: string; url: string }> = [];
    const data = d.data();
    for (const f of ['mediaUrl', 'thumbnailUrl', 'imageUrl', 'videoUrl', 'audioUrl']) {
      findDeadUrls(data[f], f, found);
    }
    for (const { field, url } of found) {
      hits.push({ collection: 'content', docId: d.id, field, url, universeId: data.universeId });
    }
  }

  // `episodes` — landing-page rail; clips[] carries per-clip videoUrl.
  const episodesSnap = await db.collection('episodes').get();
  for (const d of episodesSnap.docs) {
    const found: Array<{ field: string; url: string }> = [];
    const data = d.data();
    findDeadUrls(data.clips, 'clips', found);
    for (const f of ['videoUrl', 'thumbnailUrl', 'coverImageUrl']) {
      findDeadUrls(data[f], f, found);
    }
    for (const { field, url } of found) {
      hits.push({ collection: 'episodes', docId: d.id, field, url, universeId: data.universeId });
    }
  }

  // `offChainNodes` — fun-mode universe watch pages.
  const offChainSnap = await db.collection('offChainNodes').get();
  for (const d of offChainSnap.docs) {
    const found: Array<{ field: string; url: string }> = [];
    const data = d.data();
    for (const f of ['videoUrl', 'thumbnailUrl', 'imageUrl']) {
      findDeadUrls(data[f], f, found);
    }
    for (const { field, url } of found) {
      hits.push({
        collection: 'offChainNodes',
        docId: d.id,
        field,
        url,
        universeId: data.universeId,
      });
    }
  }

  console.log(
    `Scanned ${contentSnap.size} content + ${episodesSnap.size} episodes + ${offChainSnap.size} offChainNodes docs`
  );
  console.log(`Found ${hits.length} field(s) referencing ${DEAD_HOST}\n`);

  if (VERIFY && hits.length > 0) {
    console.log(`Verifying reachability (concurrency=${CONCURRENCY})…`);
    let cursor = 0;
    async function worker() {
      while (cursor < hits.length) {
        const i = cursor++;
        hits[i].reachable = await headOk(hits[i].url);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    const dead = hits.filter((h) => h.reachable === false).length;
    console.log(
      `  ${dead}/${hits.length} confirmed unreachable, ${hits.length - dead} still resolve\n`
    );
  }

  // Group by collection for the summary.
  const byCollection = new Map<string, Hit[]>();
  for (const h of hits) {
    if (!byCollection.has(h.collection)) byCollection.set(h.collection, []);
    byCollection.get(h.collection)!.push(h);
  }
  console.log('══════ BY COLLECTION ══════');
  for (const [col, arr] of byCollection) {
    console.log(`${col}: ${arr.length}`);
  }

  console.log('\n══════ SAMPLE (first 15) ══════');
  for (const h of hits.slice(0, 15)) {
    console.log(
      `  [${h.collection}] ${h.docId}  ${h.field}${
        h.reachable === undefined ? '' : h.reachable ? '  (still reachable)' : '  (DEAD)'
      }`
    );
    console.log(`    ${h.url}`);
  }

  const reportPath = path.resolve(process.cwd(), `dead-gcs-urls-report-${Date.now()}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ scannedAt: new Date().toISOString(), hits }, null, 2)
  );
  console.log(`\nFull report written to: ${reportPath}`);
  console.log('No writes were made — this script is read-only.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SCAN FAILED:', err);
    process.exit(1);
  });

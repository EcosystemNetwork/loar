/**
 * Backfill HLS for existing video content
 *
 * New uploads get an HLS master playlist + thumbnail sprite via the
 * fire-and-forget hook in lib/gallery-publish.ts. Content published before that
 * hook existed only has the progressive `mediaUrl`. This runs the same
 * `ensureContentHls()` pipeline over it, so the player can prefer `hlsUrl`.
 *
 * Selection (`needsHls`): mediaType video/ai-video, https mediaUrl, no hlsUrl
 * yet. Re-running is safe — finished items drop out of the selection, and a
 * failed transcode leaves the doc untouched (the original mediaUrl still plays).
 *
 * Usage:
 *   pnpm -F server tsx scripts/backfill-hls.ts
 *
 * Options (env vars):
 *   DRY_RUN=1        — list what would be transcoded, write nothing
 *   LIMIT=25         — max items to process (default: all)
 *   CONCURRENCY=2    — parallel transcodes (default 1; ffmpeg is CPU-bound)
 *   HLS_TRANSCODE_ENABLED=false makes ensureContentHls a no-op — this script refuses to run then.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const PAGE_SIZE = 200;

async function main() {
  const isDryRun = process.env.DRY_RUN === '1';
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
  const concurrency = Math.max(1, parseInt(process.env.CONCURRENCY ?? '1', 10) || 1);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     LOAR — Backfill HLS for existing video content       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  if (isDryRun) console.log('  🔍 DRY RUN — nothing will be transcoded or written\n');
  if ((process.env.HLS_TRANSCODE_ENABLED ?? 'true').toLowerCase() === 'false') {
    console.error(
      'HLS_TRANSCODE_ENABLED=false — ensureContentHls would skip everything. Aborting.'
    );
    process.exit(1);
  }

  const firebase = await import('../src/lib/firebase.js');
  if ('initFirebase' in firebase && typeof firebase.initFirebase === 'function') {
    firebase.initFirebase();
  }
  const { db } = firebase;
  if (!db) {
    console.error('ERROR: Firebase not initialized. Check FIREBASE_SERVICE_ACCOUNT in .env');
    process.exit(1);
  }
  const { ensureContentHls, needsHls, isShortForm } =
    await import('../src/services/content-hls.js');

  // Page through video content by document id (never load the whole collection).
  type Candidate = {
    id: string;
    title?: string;
    mediaUrl: string;
    mediaType: 'video' | 'ai-video';
    creatorUid?: string;
    shortForm: boolean;
  };
  const candidates: Candidate[] = [];
  let scanned = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (candidates.length < limit) {
    let q = db
      .collection('content')
      .where('mediaType', 'in', ['video', 'ai-video'])
      .orderBy('__name__')
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      scanned++;
      const d = doc.data();
      if (!needsHls(d)) continue;
      candidates.push({
        id: doc.id,
        title: d.title,
        mediaUrl: d.mediaUrl,
        mediaType: d.mediaType,
        creatorUid: d.creatorUid,
        shortForm: isShortForm(d),
      });
      if (candidates.length >= limit) break;
    }
    last = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }

  console.log(`  Scanned ${scanned} video items; ${candidates.length} need HLS\n`);
  if (candidates.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  if (isDryRun) {
    for (const c of candidates) {
      console.log(
        `  [${c.mediaType}${c.shortForm ? ', short-form' : ''}] ${c.title || '(untitled)'} (${c.id})`
      );
    }
    console.log('\nRun without DRY_RUN=1 to transcode.');
    process.exit(0);
  }

  const totals = { transcoded: 0, failed: 0, errored: 0 };
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const i = next++;
      const c = candidates[i];
      const label = `[${i + 1}/${candidates.length}]`;
      console.log(`${label} ${c.mediaType}: "${c.title || c.id}"`);
      try {
        const r = await ensureContentHls({
          id: c.id,
          mediaUrl: c.mediaUrl,
          mediaType: c.mediaType,
          creatorUid: c.creatorUid,
          shortForm: c.shortForm,
        });
        if (r.source === 'transcoded') {
          totals.transcoded++;
          console.log(`${label}   ✓ ${r.renditionCount} renditions → ${r.hlsUrl}`);
        } else {
          totals.failed++;
          console.log(`${label}   ✗ transcode failed (left unchanged)`);
        }
      } catch (err) {
        totals.errored++;
        console.error(`${label}   ✗ error:`, err instanceof Error ? err.message : err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));

  console.log(
    `\nDone. transcoded=${totals.transcoded} failed=${totals.failed} errored=${totals.errored}`
  );
  process.exit(totals.errored > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

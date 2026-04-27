/**
 * Backfill HLS renditions + WebVTT thumbnail sprites for existing video
 * content. Iterates the `content` Firestore collection and runs the same
 * `ensureContentHls` pipeline used by the live upload path on every video
 * doc that's still missing `hlsUrl`.
 *
 * Long-running. Each video produces 3 ffmpeg renditions + 30–100 IPFS
 * uploads, so concurrency is intentionally low (default 1). Bump
 * `--concurrency` only if your transcoder has CPU headroom AND your storage
 * provider allows the burst.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-hls.ts                       # dry run
 *   pnpm tsx scripts/backfill-hls.ts --apply               # write
 *   pnpm tsx scripts/backfill-hls.ts --apply --limit 5
 *   pnpm tsx scripts/backfill-hls.ts --apply --concurrency 2
 *   pnpm tsx scripts/backfill-hls.ts --apply --short-form  # skip 1080p
 *
 * Skip rules: docs already have `hlsUrl`, non-video mediaType, mediaUrl
 * isn't HTTPS, or contentStatus is flagged/hidden/removed.
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const SHORT_FORM = process.argv.includes('--short-form');
const limitArgIdx = process.argv.indexOf('--limit');
const LIMIT = limitArgIdx !== -1 ? Number(process.argv[limitArgIdx + 1]) : Infinity;
const concurrencyArgIdx = process.argv.indexOf('--concurrency');
const CONCURRENCY = concurrencyArgIdx !== -1 ? Number(process.argv[concurrencyArgIdx + 1]) : 1;

function isHttpsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (Number.isFinite(LIMIT)) console.log(`limit: ${LIMIT}`);
  console.log(`concurrency: ${CONCURRENCY}${SHORT_FORM ? ' (skip 1080p)' : ''}`);

  // Server modules need dotenv loaded before import (env validation runs at
  // module init). Use dynamic imports after dotenv.config above.
  const { initFirebase } = await import('../apps/server/src/lib/firebase');
  initFirebase();
  const firebaseModule = await import('../apps/server/src/lib/firebase');
  const db = firebaseModule.db;
  if (!db) {
    console.error('Firestore not initialized — check FIREBASE_SERVICE_ACCOUNT(_PATH)');
    process.exit(1);
  }
  const { ensureContentHls } = await import('../apps/server/src/services/content-hls');

  const snap = await db.collection('content').get();
  console.log(`scanning ${snap.size} content docs for HLS backfill candidates...`);

  type DocRef = FirebaseFirestore.QueryDocumentSnapshot;
  const candidates: DocRef[] = snap.docs.filter((doc) => {
    const d = doc.data();
    const isVideo = d.mediaType === 'video' || d.mediaType === 'ai-video';
    if (!isVideo) return false;
    if (d.hlsUrl) return false; // already done
    if (!isHttpsUrl(d.mediaUrl)) return false;
    const status = d.contentStatus || 'active';
    if (status !== 'active' && status !== 'reinstated') return false;
    return true;
  });
  console.log(`found ${candidates.length} videos needing HLS`);

  const work = candidates.slice(0, Number.isFinite(LIMIT) ? LIMIT : candidates.length);
  if (!APPLY) {
    console.log('\ndry-run preview (first 10):');
    for (const doc of work.slice(0, 10)) {
      const d = doc.data();
      console.log(`  ${doc.id.slice(0, 6)}…  ${(d.title || '').slice(0, 50)}`);
    }
    console.log(`\n${work.length} would be transcoded. re-run with --apply.`);
    return;
  }

  const counts = { transcoded: 0, failed: 0, skipped: 0 };

  async function processOne(doc: DocRef) {
    const d = doc.data();
    const label = `${doc.id.slice(0, 6)}… ${(d.title || '').slice(0, 40)}`;
    const t0 = Date.now();

    try {
      const result = await ensureContentHls({
        id: doc.id,
        mediaUrl: d.mediaUrl,
        mediaType: d.mediaType,
        creatorUid: d.creatorUid,
        shortForm: SHORT_FORM,
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if (result.source === 'transcoded') {
        counts.transcoded++;
        console.log(
          `${label}  ✓ ${elapsed}s renditions=${result.renditionCount} hls=${(result.hlsUrl || '').slice(0, 60)}`
        );
      } else if (result.source === 'failed') {
        counts.failed++;
        console.log(`${label}  ✗ ${elapsed}s transcode failed`);
      } else {
        counts.skipped++;
        console.log(`${label}  – skipped (${result.source})`);
      }
    } catch (err) {
      counts.failed++;
      console.log(`${label}  ✗ error: ${(err as Error).message.slice(0, 80)}`);
    }
  }

  const queue = [...work];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const doc = queue.shift();
          if (!doc) break;
          await processOne(doc);
        }
      })()
    );
  }
  await Promise.all(workers);

  console.log('\nsummary:', counts);
  console.log('✓ done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

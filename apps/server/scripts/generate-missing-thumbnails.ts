/**
 * Backfill Missing Gallery Thumbnails
 *
 * Finds all `content` docs in Firestore where thumbnailUrl is null/empty and
 * fills them in via the shared ensureContentThumbnail() pipeline:
 *   - image / ai-image → copy mediaUrl into thumbnailUrl
 *   - video / ai-video → extract a frame with ffmpeg → Pinata
 *   - audio / 3d       → skipped (no canonical cover; UI renders kind tile)
 *
 * Usage:
 *   pnpm -F server tsx scripts/generate-missing-thumbnails.ts
 *
 * Options (env vars):
 *   DRY_RUN=1                    — list content needing covers, don't write
 *   MEDIA_TYPE_FILTER=video,image — only process specific mediaTypes
 *   LIMIT=50                     — max docs to process (default: all)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const isDryRun = process.env.DRY_RUN === '1';
  const mediaTypeFilter = process.env.MEDIA_TYPE_FILTER?.split(',').map((k) => k.trim());
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     LOAR — Backfill Missing Gallery Thumbnails           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  if (isDryRun) console.log('  🔍 DRY RUN — no thumbnails will be written\n');
  if (mediaTypeFilter) console.log(`  Filter: ${mediaTypeFilter.join(', ')}\n`);

  const firebase = await import('../src/lib/firebase.js');
  if ('initFirebase' in firebase && typeof firebase.initFirebase === 'function') {
    firebase.initFirebase();
  }
  const { db } = firebase;
  if (!db) {
    console.error('ERROR: Firebase not initialized. Check FIREBASE_SERVICE_ACCOUNT in .env');
    process.exit(1);
  }
  const { ensureContentThumbnail } = await import('../src/services/content-cover-image.js');

  console.log('Fetching all content from Firestore...');
  const snapshot = await db.collection('content').get();
  const allContent = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Array<{
    id: string;
    title?: string;
    mediaUrl?: string;
    mediaType?: string;
    thumbnailUrl?: string | null;
    creatorUid?: string;
  }>;

  console.log(`  Total content: ${allContent.length}`);

  let needsThumb = allContent.filter((c) => !c.thumbnailUrl && c.mediaUrl);
  if (mediaTypeFilter) {
    needsThumb = needsThumb.filter((c) => c.mediaType && mediaTypeFilter.includes(c.mediaType));
  }
  if (needsThumb.length > limit) {
    needsThumb = needsThumb.slice(0, limit);
  }

  console.log(`  Missing thumbnails: ${needsThumb.length}\n`);

  if (needsThumb.length === 0) {
    console.log('All content already has thumbnails. Nothing to do.');
    process.exit(0);
  }

  const byType: Record<string, number> = {};
  for (const c of needsThumb) {
    const t = c.mediaType || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
  }
  console.log('  Breakdown:');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
  console.log();

  if (isDryRun) {
    console.log('Content needing thumbnails:');
    for (const c of needsThumb) {
      console.log(`  [${c.mediaType}] ${c.title || '(untitled)'} (${c.id})`);
    }
    console.log('\nRun without DRY_RUN=1 to backfill thumbnails.');
    process.exit(0);
  }

  const SUPPORTED_KINDS = new Set(['image', 'ai-image', 'video', 'ai-video']);
  let done = 0;
  let copied = 0;
  let extracted = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < needsThumb.length; i++) {
    const c = needsThumb[i];
    const label = `[${i + 1}/${needsThumb.length}]`;
    const mediaType = c.mediaType || '';

    if (!SUPPORTED_KINDS.has(mediaType)) {
      console.log(`${label} SKIP (${mediaType}): ${c.title || c.id}`);
      skipped++;
      continue;
    }

    console.log(`${label} ${mediaType}: "${c.title || c.id}"`);
    try {
      const result = await ensureContentThumbnail({
        id: c.id,
        mediaUrl: c.mediaUrl!,
        mediaType: mediaType as 'image' | 'ai-image' | 'video' | 'ai-video',
        creatorUid: c.creatorUid,
      });
      if (result.source === 'mediaUrl') {
        copied++;
        console.log(`  → copied mediaUrl`);
      } else if (result.source === 'extracted') {
        extracted++;
        console.log(`  → extracted frame: ${result.thumbnailUrl}`);
      } else {
        skipped++;
        console.log(`  → skipped (${result.source})`);
      }
      done++;

      if (mediaType === 'video' || mediaType === 'ai-video') {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${(err as Error).message}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(
    `  COMPLETE — ${done} processed (${copied} copied, ${extracted} extracted), ${skipped} skipped, ${failed} failed`
  );
  console.log('═'.repeat(60) + '\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

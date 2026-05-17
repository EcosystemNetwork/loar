/**
 * Recover all generated content into the gallery and wiki.
 *
 * What this does:
 *   1. Pins every `videoGenerations` doc that still has an ephemeral/expiring
 *      URL to permanent IPFS via Pinata (if the URL hasn't expired yet).
 *   2. Ensures every completed `videoGenerations` / `imageGenerations` has a
 *      matching `content` doc so it appears in the gallery.
 *   3. Ensures every generation that was tied to an entity has a matching
 *      `mediaAttachments` doc so it appears in the wiki.
 *
 * What this does NOT do:
 *   - Does NOT touch any content with `contentStatus === 'removed'` (owner deleted).
 *   - Does NOT publish content marked `visibility === 'private'`.
 *   - Does NOT update on-chain state (separate concern — would need MediaUpdated calls).
 *
 * Usage:
 *   DRY_RUN=1 pnpm tsx scripts/recover-all-content.ts         # report only
 *   pnpm tsx scripts/recover-all-content.ts                    # execute
 *   pnpm tsx scripts/recover-all-content.ts videos-only        # skip images
 *
 * Required env:
 *   PINATA_JWT                      — for rehosting
 *   PINATA_GATEWAY_URL              — optional; defaults to public gateway
 *   FIREBASE_SERVICE_ACCOUNT_PATH   — or FIREBASE_SERVICE_ACCOUNT json
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'fs';
import { rehostVideoToPinata, isEphemeralVideoUrl } from './lib/rehost-video';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const MODE = (process.argv[2] ?? 'all') as 'all' | 'videos-only' | 'images-only' | 'gallery-only';
const REHOST_CONCURRENCY = Number(process.env.REHOST_CONCURRENCY ?? '3');

// ── Firebase: SA env/file if present, else fall back to gcloud ADC ──────
const saPathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const saPath = saPathEnv ? path.resolve(process.cwd(), saPathEnv) : '';
let credentialOpts: any;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  credentialOpts = { credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) };
} else if (saPath && existsSync(saPath)) {
  try {
    const sa = JSON.parse(readFileSync(saPath, 'utf-8'));
    credentialOpts = { credential: cert(sa) };
  } catch {
    credentialOpts = { credential: applicationDefault(), projectId: 'loar-db' };
  }
} else {
  credentialOpts = { credential: applicationDefault(), projectId: 'loar-db' };
}
const app = initializeApp(credentialOpts, `recover-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

// ── Helpers ─────────────────────────────────────────────────────────────
function toDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildGalleryDoc(input: {
  creatorUid: string;
  mediaUrl: string;
  mediaType: 'ai-video' | 'ai-image';
  title: string;
  description: string;
  thumbnailUrl?: string | null;
  universeId?: string | null;
  generationId: string;
  generationModel: string;
  visibility?: 'public' | 'private' | 'unlisted';
  createdAt: Date;
}) {
  return {
    title: input.title.slice(0, 100) || 'Generated',
    description: input.description,
    mediaUrl: input.mediaUrl,
    thumbnailUrl: input.thumbnailUrl ?? null,
    mediaType: input.mediaType,
    classification: 'original',
    tags: [],
    ipDeclaration: {
      isOriginal: true,
      usesCopyrightedMaterial: false,
      license: 'all-rights-reserved',
    },
    visibility: input.visibility ?? 'public',
    creatorUid: input.creatorUid,
    ...(input.universeId ? { universeId: input.universeId } : {}),
    createdAt: input.createdAt,
    updatedAt: new Date(),
    views: 0,
    likes: 0,
    reviewStatus: 'not_required',
    generationId: input.generationId,
    generationModel: input.generationModel,
  };
}

async function rehostConcurrent<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const running: Promise<void>[] = [];
  while (queue.length > 0 || running.length > 0) {
    while (running.length < limit && queue.length > 0) {
      const item = queue.shift()!;
      const p = worker(item).finally(() => {
        const idx = running.indexOf(p);
        if (idx >= 0) running.splice(idx, 1);
      });
      running.push(p);
    }
    if (running.length > 0) await Promise.race(running);
  }
}

// ── Phase 1: Rehost ephemeral video URLs to Pinata ─────────────────────
interface RehostStats {
  total: number;
  alreadyPermanent: number;
  rehosted: number;
  expired: number;
  failed: number;
}

async function phaseRehostVideos(): Promise<RehostStats> {
  console.log(`\n═══ Phase 1: Rehost ephemeral video URLs ═══`);
  const snap = await db.collection('videoGenerations').where('status', '==', 'completed').get();

  const stats: RehostStats = {
    total: snap.size,
    alreadyPermanent: 0,
    rehosted: 0,
    expired: 0,
    failed: 0,
  };

  const needsRehost: Array<{ id: string; data: any }> = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.permanentVideoUrl) {
      stats.alreadyPermanent++;
      continue;
    }
    if (!d.videoUrl) continue;
    if (!isEphemeralVideoUrl(d.videoUrl)) {
      stats.alreadyPermanent++;
      continue;
    }
    needsRehost.push({ id: doc.id, data: d });
  }

  console.log(`  ${stats.total} completed generations`);
  console.log(`  ${stats.alreadyPermanent} already permanent — skipping`);
  console.log(`  ${needsRehost.length} need rehost`);

  if (DRY_RUN) {
    console.log(`  [DRY_RUN] would rehost ${needsRehost.length} videos`);
    return stats;
  }

  let done = 0;
  await rehostConcurrent(needsRehost, REHOST_CONCURRENCY, async (gen) => {
    const label = gen.data.sceneTitle || gen.data.prompt?.slice(0, 40) || gen.id;
    try {
      const pin = await rehostVideoToPinata(gen.data.videoUrl, {
        filename: `gen-${gen.id}.mp4`,
        pinName: `recover/${gen.id}`,
        timeoutMs: 180_000,
      });
      await db.collection('videoGenerations').doc(gen.id).update({
        permanentVideoUrl: pin.url,
        storageContentHash: pin.contentHash,
        storagePersisted: true,
        storagePersistedAt: new Date(),
      });
      stats.rehosted++;
      done++;
      console.log(`  [${done}/${needsRehost.length}] ✓ ${label}`);
    } catch (err: any) {
      const msg = err.message ?? String(err);
      const expired = msg.includes('403') || msg.includes('expired') || msg.includes('HTTP 4');
      if (expired) {
        stats.expired++;
        await db.collection('videoGenerations').doc(gen.id).update({
          storagePersistFailed: 'expired',
          storagePersistFailedAt: new Date(),
        });
      } else {
        stats.failed++;
      }
      done++;
      console.log(`  [${done}/${needsRehost.length}] ✗ ${label} — ${msg.slice(0, 80)}`);
    }
  });

  return stats;
}

// ── Phase 2: Ensure gallery content docs exist ─────────────────────────
interface GalleryStats {
  total: number;
  alreadyInGallery: number;
  skippedRemoved: number;
  skippedPrivate: number;
  skippedExpired: number;
  created: number;
  updated: number;
}

async function phaseBackfillGallery(
  collection: 'videoGenerations' | 'imageGenerations'
): Promise<GalleryStats> {
  const mediaType = collection === 'videoGenerations' ? 'ai-video' : 'ai-image';
  console.log(`\n═══ Phase 2: Backfill gallery from ${collection} (${mediaType}) ═══`);

  const snap = await db.collection(collection).where('status', '==', 'completed').get();

  // Index existing content docs by generationId to avoid dup-creates.
  const contentSnap = await db.collection('content').get();
  const byGenId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of contentSnap.docs) {
    const gid = doc.data().generationId;
    if (gid) byGenId.set(gid, doc);
  }

  const stats: GalleryStats = {
    total: snap.size,
    alreadyInGallery: 0,
    skippedRemoved: 0,
    skippedPrivate: 0,
    skippedExpired: 0,
    created: 0,
    updated: 0,
  };

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;

  const flushBatch = async () => {
    if (batchCount > 0 && !DRY_RUN) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  };

  for (const doc of snap.docs) {
    const gen = doc.data();
    const genId = doc.id;

    // Resolve preferred URL: permanent > the raw URL (only if not ephemeral)
    let mediaUrl: string | null = null;
    let thumbnail: string | null = null;
    if (collection === 'videoGenerations') {
      mediaUrl = gen.permanentVideoUrl || null;
      if (!mediaUrl && gen.videoUrl && !isEphemeralVideoUrl(gen.videoUrl)) {
        mediaUrl = gen.videoUrl;
      }
      thumbnail = gen.imageUrl || gen.thumbnailUrl || null;
    } else {
      // imageGenerations — imageUrls is the array; pick first permanent one
      const urls: string[] = Array.isArray(gen.imageUrls) ? gen.imageUrls : [];
      const first = urls.find((u) => u && !isEphemeralVideoUrl(u)) || urls[0] || null;
      mediaUrl = first;
      thumbnail = first;
    }

    if (!mediaUrl) {
      stats.skippedExpired++;
      continue;
    }

    const existing = byGenId.get(genId);
    if (existing) {
      const e = existing.data();
      // Respect owner/admin takedown
      if (e.contentStatus === 'removed') {
        stats.skippedRemoved++;
        continue;
      }
      // Content is already there — patch mediaUrl if it's stale (ephemeral)
      if (e.mediaUrl !== mediaUrl && isEphemeralVideoUrl(e.mediaUrl || '')) {
        if (DRY_RUN) {
          stats.updated++;
        } else {
          batch.update(existing.ref, {
            mediaUrl,
            ...(thumbnail ? { thumbnailUrl: thumbnail } : {}),
            updatedAt: new Date(),
          });
          batchCount++;
          stats.updated++;
          if (batchCount >= BATCH_SIZE) await flushBatch();
        }
      } else {
        stats.alreadyInGallery++;
      }
      continue;
    }

    // Respect generation-level privacy markers if present
    if (gen.visibility === 'private' || gen.private === true) {
      stats.skippedPrivate++;
      continue;
    }

    const doc_ = db.collection('content').doc();
    const galleryDoc = buildGalleryDoc({
      creatorUid: gen.userId || gen.creatorUid || 'unknown',
      mediaUrl,
      thumbnailUrl: thumbnail,
      mediaType,
      title: gen.originalPrompt || gen.prompt || gen.sceneTitle || 'Generated',
      description: gen.originalPrompt || gen.prompt || '',
      universeId: gen.universeId ?? null,
      generationId: genId,
      generationModel: gen.finalModelId || gen.model || '',
      createdAt: toDate(gen.createdAt) || new Date(),
    });

    if (DRY_RUN) {
      stats.created++;
    } else {
      batch.set(doc_, galleryDoc);
      batchCount++;
      stats.created++;
      if (batchCount >= BATCH_SIZE) await flushBatch();
    }
  }

  await flushBatch();

  console.log(`  total:            ${stats.total}`);
  console.log(`  already present:  ${stats.alreadyInGallery}`);
  console.log(`  created:          ${stats.created}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`  updated URL:      ${stats.updated}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`  skipped removed:  ${stats.skippedRemoved}`);
  console.log(`  skipped private:  ${stats.skippedPrivate}`);
  console.log(`  skipped expired:  ${stats.skippedExpired}`);

  return stats;
}

// ── Phase 3: Ensure wiki attachments exist ─────────────────────────────
interface WikiStats {
  total: number;
  alreadyAttached: number;
  created: number;
  skippedNoUrl: number;
  skippedNoEntity: number;
  skippedRemoved: number;
}

async function phaseBackfillWiki(
  collection: 'videoGenerations' | 'imageGenerations'
): Promise<WikiStats> {
  const category = collection === 'videoGenerations' ? 'video' : 'image';
  const mime = collection === 'videoGenerations' ? 'video/mp4' : 'image/png';
  console.log(`\n═══ Phase 3: Backfill wiki attachments from ${collection} (${category}) ═══`);

  const snap = await db.collection(collection).where('status', '==', 'completed').get();

  // Index existing mediaAttachments by (generationId, targetId) to avoid dup.
  const attachSnap = await db.collection('mediaAttachments').get();
  const existingKeys = new Set<string>();
  for (const doc of attachSnap.docs) {
    const d = doc.data();
    if (d.generationId && d.targetId) {
      existingKeys.add(`${d.generationId}::${d.targetId}`);
    }
  }

  const stats: WikiStats = {
    total: snap.size,
    alreadyAttached: 0,
    created: 0,
    skippedNoUrl: 0,
    skippedNoEntity: 0,
    skippedRemoved: 0,
  };

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;

  const flushBatch = async () => {
    if (batchCount > 0 && !DRY_RUN) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  };

  for (const doc of snap.docs) {
    const gen = doc.data();
    const genId = doc.id;
    const entityId = gen.entityId || gen.targetEntityId;
    if (!entityId) {
      stats.skippedNoEntity++;
      continue;
    }

    // Skip if the entity itself was removed
    const entityDoc = await db.collection('entities').doc(entityId).get();
    if (entityDoc.exists && entityDoc.data()?.contentStatus === 'removed') {
      stats.skippedRemoved++;
      continue;
    }

    let url: string | null = null;
    if (collection === 'videoGenerations') {
      url = gen.permanentVideoUrl || (isEphemeralVideoUrl(gen.videoUrl) ? null : gen.videoUrl);
    } else {
      const urls: string[] = Array.isArray(gen.imageUrls) ? gen.imageUrls : [];
      url = urls.find((u) => u && !isEphemeralVideoUrl(u)) || urls[0] || null;
    }
    if (!url) {
      stats.skippedNoUrl++;
      continue;
    }

    const key = `${genId}::${entityId}`;
    if (existingKeys.has(key)) {
      stats.alreadyAttached++;
      continue;
    }

    const ref = db.collection('mediaAttachments').doc();
    const data = {
      contentHash: gen.storageContentHash || `gen:${genId}:${category}`,
      originalFilename: `generation-${genId}.${category === 'video' ? 'mp4' : 'png'}`,
      mimeType: mime,
      size: 0,
      url,
      targetType: 'entity',
      targetId: entityId,
      targetName: entityDoc.data()?.name ?? '',
      category,
      label: (gen.originalPrompt || gen.prompt || '').slice(0, 80),
      subCategory: null,
      version: 1,
      variantOf: null,
      variantLabel: null,
      sortOrder: 0,
      generationId: genId,
      creator: String(gen.userId || gen.creatorUid || '').toLowerCase(),
      createdAt: toDate(gen.createdAt) || new Date(),
      updatedAt: new Date(),
    };

    if (DRY_RUN) {
      stats.created++;
    } else {
      batch.set(ref, data);
      batchCount++;
      stats.created++;
      if (batchCount >= BATCH_SIZE) await flushBatch();
    }
  }

  await flushBatch();

  console.log(`  total:            ${stats.total}`);
  console.log(`  already attached: ${stats.alreadyAttached}`);
  console.log(`  created:          ${stats.created}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`  skipped no URL:   ${stats.skippedNoUrl}`);
  console.log(`  skipped no entity:${stats.skippedNoEntity}`);
  console.log(`  skipped removed:  ${stats.skippedRemoved}`);

  return stats;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
════════════════════════════════════════════════════════════
  LOAR — Recover All Generated Content
════════════════════════════════════════════════════════════
  Mode    : ${MODE}
  Dry run : ${DRY_RUN}
  Concurr.: ${REHOST_CONCURRENCY} (rehost)
`);

  if (MODE === 'all' || MODE === 'videos-only') {
    const r1 = await phaseRehostVideos();
    console.log(`\n  rehost summary: ${JSON.stringify(r1)}`);
  }

  if (MODE !== 'images-only') {
    await phaseBackfillGallery('videoGenerations');
    await phaseBackfillWiki('videoGenerations');
  }

  if (MODE === 'all' || MODE === 'images-only') {
    await phaseBackfillGallery('imageGenerations');
    await phaseBackfillWiki('imageGenerations');
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RECOVERY COMPLETE${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});

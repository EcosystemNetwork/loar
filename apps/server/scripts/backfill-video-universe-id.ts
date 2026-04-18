/**
 * Backfill universeId on orphan video content docs.
 *
 * Videos generated through the legacy generation.* video mutations before the
 * universeId fix landed were written to the `content` collection without a
 * `universeId` field. The Universe Gallery filters by `universeId == X`, so
 * those docs are invisible there.
 *
 * Resolution strategy (first match wins, per orphan video):
 *   A. Join on generations.universeId via the video's generationId.
 *   B. Temporal neighbor: nearest `content` doc by same creator with a
 *      universeId, within TEMPORAL_WINDOW_MS. Assumes a creator works in one
 *      universe at a time.
 *   C. Dominant universe: if the creator's other public content overwhelmingly
 *      (>= DOMINANT_THRESHOLD) sits in one universe, adopt it.
 *
 * Usage:
 *   pnpm -F server tsx scripts/backfill-video-universe-id.ts
 *   DRY_RUN=1 pnpm -F server tsx scripts/backfill-video-universe-id.ts
 *
 * Tuning (env vars):
 *   TEMPORAL_WINDOW_HOURS=6         — max gap for neighbor match (default 6)
 *   DOMINANT_THRESHOLD=0.8          — share required for dominant match (default 0.8)
 *   DISABLE_TEMPORAL=1              — skip strategy B
 *   DISABLE_DOMINANT=1              — skip strategy C
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

type ContentDoc = {
  id: string;
  creatorUid?: string;
  generationId?: string;
  universeId?: string | null;
  mediaType?: string;
  createdAt?: any;
};

function toMillis(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts?.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') {
    const n = Date.parse(ts);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof ts === 'number') return ts;
  return null;
}

async function main() {
  const isDryRun = process.env.DRY_RUN === '1';
  const temporalWindowMs =
    (parseFloat(process.env.TEMPORAL_WINDOW_HOURS || '6') || 6) * 60 * 60 * 1000;
  const dominantThreshold = parseFloat(process.env.DOMINANT_THRESHOLD || '0.8') || 0.8;
  const disableTemporal = process.env.DISABLE_TEMPORAL === '1';
  const disableDominant = process.env.DISABLE_DOMINANT === '1';

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     LOAR — Backfill universeId on Video Content          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  if (isDryRun) console.log('  DRY RUN — no writes will be made\n');
  console.log(`  Temporal window:    ±${temporalWindowMs / 3_600_000}h`);
  console.log(`  Dominant threshold: ${(dominantThreshold * 100).toFixed(0)}%`);
  console.log(`  Temporal fallback:  ${disableTemporal ? 'off' : 'on'}`);
  console.log(`  Dominant fallback:  ${disableDominant ? 'off' : 'on'}\n`);

  const firebase = await import('../src/lib/firebase.js');
  if ('initFirebase' in firebase && typeof firebase.initFirebase === 'function') {
    firebase.initFirebase();
  }
  const { db } = firebase;
  if (!db) {
    console.error('ERROR: Firebase not initialized. Check FIREBASE_SERVICE_ACCOUNT in .env');
    process.exit(1);
  }

  console.log('Fetching video content…');
  const videoSnap = await db
    .collection('content')
    .where('mediaType', 'in', ['video', 'ai-video'])
    .get();

  const orphans = videoSnap.docs.filter((d) => !d.data().universeId);
  console.log(`  Total video content: ${videoSnap.size}`);
  console.log(`  Orphans (no universeId): ${orphans.length}\n`);

  if (orphans.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Build per-creator index of anchor signals — any record with (creator,
  // universeId, createdAt). Pulls from both `content` and `generations` so
  // image generations and peer content act as anchors for orphan videos.
  console.log('Indexing creator → anchor signals (content + generations)…');
  const creatorUids = [...new Set(orphans.map((d) => d.data().creatorUid).filter(Boolean))];
  const creatorIndex = new Map<
    string,
    {
      anchors: Array<{ universeId: string; createdAtMs: number }>;
      dominantUniverseId?: string;
      dominantShare?: number;
    }
  >();

  // Firestore 'in' supports up to 30 values, chunk accordingly.
  const chunk = <T>(arr: T[], n: number) =>
    Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  const pushAnchor = (creatorUid: string, universeId: string, createdAtMs: number) => {
    let entry = creatorIndex.get(creatorUid);
    if (!entry) {
      entry = { anchors: [] };
      creatorIndex.set(creatorUid, entry);
    }
    entry.anchors.push({ universeId, createdAtMs });
  };

  for (const creatorChunk of chunk(creatorUids as string[], 30)) {
    const contentSnap = await db
      .collection('content')
      .where('creatorUid', 'in', creatorChunk)
      .get();

    for (const doc of contentSnap.docs) {
      const d = doc.data() as ContentDoc;
      if (!d.creatorUid || !d.universeId) continue;
      const createdAtMs = toMillis(d.createdAt);
      if (createdAtMs == null) continue;
      pushAnchor(d.creatorUid, d.universeId, createdAtMs);
    }

    const genSnap = await db.collection('generations').where('userId', 'in', creatorChunk).get();

    for (const doc of genSnap.docs) {
      const d = doc.data() as { userId?: string; universeId?: string; createdAt?: any };
      if (!d.userId || !d.universeId) continue;
      const createdAtMs = toMillis(d.createdAt);
      if (createdAtMs == null) continue;
      pushAnchor(d.userId, d.universeId, createdAtMs);
    }
  }

  // Compute dominant universe per creator.
  for (const [, entry] of creatorIndex) {
    if (entry.anchors.length === 0) continue;
    const counts = new Map<string, number>();
    for (const a of entry.anchors) counts.set(a.universeId, (counts.get(a.universeId) || 0) + 1);
    let top = '';
    let topCount = 0;
    for (const [u, c] of counts) {
      if (c > topCount) {
        top = u;
        topCount = c;
      }
    }
    entry.dominantUniverseId = top;
    entry.dominantShare = topCount / entry.anchors.length;
  }

  const resolution = {
    byGeneration: 0,
    byTemporal: 0,
    byDominant: 0,
    unresolved: 0,
  };
  const updates: Array<{
    docId: string;
    universeId: string;
    strategy: 'generation' | 'temporal' | 'dominant';
    details: string;
  }> = [];

  console.log('Resolving orphans…\n');
  for (const doc of orphans) {
    const data = doc.data() as ContentDoc;
    const creatorUid = data.creatorUid;
    const createdAtMs = toMillis(data.createdAt);

    // Strategy A: join on generations.universeId
    if (data.generationId) {
      const genDoc = await db.collection('videoGenerations').doc(data.generationId).get();
      const universeId = genDoc.exists
        ? (genDoc.data()?.universeId as string | undefined)
        : undefined;
      if (universeId) {
        resolution.byGeneration++;
        updates.push({
          docId: doc.id,
          universeId,
          strategy: 'generation',
          details: `gen=${data.generationId}`,
        });
        continue;
      }
    }

    const entry = creatorUid ? creatorIndex.get(creatorUid) : undefined;

    // Strategy B: temporal neighbor
    if (!disableTemporal && entry && createdAtMs != null) {
      let best: { universeId: string; delta: number } | null = null;
      for (const anchor of entry.anchors) {
        const delta = Math.abs(anchor.createdAtMs - createdAtMs);
        if (delta > temporalWindowMs) continue;
        if (!best || delta < best.delta) best = { universeId: anchor.universeId, delta };
      }
      if (best) {
        resolution.byTemporal++;
        updates.push({
          docId: doc.id,
          universeId: best.universeId,
          strategy: 'temporal',
          details: `Δ=${(best.delta / 60_000).toFixed(1)}min`,
        });
        continue;
      }
    }

    // Strategy C: dominant universe
    if (
      !disableDominant &&
      entry?.dominantUniverseId &&
      (entry.dominantShare ?? 0) >= dominantThreshold
    ) {
      resolution.byDominant++;
      updates.push({
        docId: doc.id,
        universeId: entry.dominantUniverseId,
        strategy: 'dominant',
        details: `share=${((entry.dominantShare ?? 0) * 100).toFixed(0)}%`,
      });
      continue;
    }

    resolution.unresolved++;
  }

  // Print plan
  for (const u of updates) {
    console.log(`  [${u.strategy.padEnd(10)}] ${u.docId} → ${u.universeId}  (${u.details})`);
  }

  // Apply
  let written = 0;
  if (!isDryRun && updates.length > 0) {
    console.log('\nWriting updates…');
    const BATCH = 400;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = db.batch();
      const slice = updates.slice(i, i + BATCH);
      for (const u of slice) {
        batch.update(db.collection('content').doc(u.docId), {
          universeId: u.universeId,
          universeIdBackfillStrategy: u.strategy,
          updatedAt: new Date(),
        });
      }
      await batch.commit();
      written += slice.length;
    }
  }

  console.log('\n─── Summary ───────────────────────────────────────────────');
  console.log(`  Resolved via generations:       ${resolution.byGeneration}`);
  console.log(`  Resolved via temporal neighbor: ${resolution.byTemporal}`);
  console.log(`  Resolved via dominant universe: ${resolution.byDominant}`);
  console.log(`  Still unresolved:               ${resolution.unresolved}`);
  console.log(`  Written:                        ${isDryRun ? '0 (dry run)' : written}`);
  console.log('───────────────────────────────────────────────────────────\n');

  if (resolution.unresolved > 0) {
    console.log(
      `Note: ${resolution.unresolved} orphan(s) could not be matched. Creators either have\n` +
        'no other universe-tagged content, or their work spans multiple universes without\n' +
        'a clear temporal anchor. Relax TEMPORAL_WINDOW_HOURS / DOMINANT_THRESHOLD or\n' +
        'reassign manually.\n'
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });

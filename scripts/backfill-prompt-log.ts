/**
 * Backfill the `promptLog` corpus from pre-existing generation records.
 *
 * `capturePrompt()` (apps/server/src/services/prompt-log) only captures
 * prompts submitted *after* it shipped. This script walks the generation
 * collections that already store prompt text and writes the historical rows
 * into `promptLog` so the /admin/prompts corpus (and any training export) is
 * complete.
 *
 * Idempotent: each source (collection, docId, field) maps to a deterministic
 * promptLog doc id, so re-running overwrites rather than duplicates.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-prompt-log.ts                         # write
 *   DRY_RUN=1 pnpm tsx scripts/backfill-prompt-log.ts               # no writes
 *   ONLY=videoGenerations,voiceGenerations pnpm tsx scripts/backfill-prompt-log.ts
 */

import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type PromptKind = 'video' | 'image' | 'audio' | 'threed' | 'text' | 'edit' | 'other';

interface SourceSpec {
  collection: string;
  /** Input fields on the source doc that hold prompt text, in priority order. */
  fields: string[];
  /** Doc fields to try, in order, for the submitting user's id. */
  userFields: string[];
  /** Static kind, or a resolver from the doc data. */
  kind: PromptKind | ((data: Record<string, unknown>) => PromptKind);
  modelFields?: string[];
  providerFields?: string[];
  universeFields?: string[];
}

const SOURCES: SourceSpec[] = [
  {
    collection: 'videoGenerations',
    fields: ['prompt', 'originalPrompt', 'negativePrompt'],
    userFields: ['userId', 'creatorUid', 'uid'],
    kind: 'video',
    modelFields: ['finalModelId', 'requestedModelId', 'model'],
    providerFields: ['provider'],
    universeFields: ['universeId', 'universeAddress'],
  },
  {
    collection: 'zaiVideoJobs',
    fields: ['prompt', 'negativePrompt'],
    userFields: ['userId', 'uid'],
    kind: 'video',
    modelFields: ['model'],
    providerFields: ['provider'],
  },
  {
    collection: 'voiceGenerations',
    fields: ['text', 'prompt'],
    userFields: ['userId', 'uid', 'creatorUid'],
    kind: 'audio',
    modelFields: ['model', 'modelId'],
    providerFields: ['provider'],
  },
  {
    collection: 'profileGenerations',
    fields: ['prompt'],
    userFields: ['userId', 'uid', 'creatorUid'],
    kind: 'image',
    modelFields: ['model', 'modelId'],
    providerFields: ['provider'],
  },
  {
    collection: 'studioJobs',
    fields: ['prompt', 'negativePrompt'],
    userFields: ['userId', 'uid', 'creatorUid'],
    kind: (d) => {
      const t = String(d.type ?? d.kind ?? d.jobType ?? '').toLowerCase();
      if (t.includes('video')) return 'video';
      if (t.includes('audio') || t.includes('voice') || t.includes('music')) return 'audio';
      if (t.includes('3d') || t.includes('mesh')) return 'threed';
      return 'image';
    },
    modelFields: ['model', 'modelId'],
    providerFields: ['provider'],
  },
  {
    collection: 'content',
    // Gallery/content docs written by the auto-publish path carry the prompt
    // as `description` (see generation.routes.ts autoPublishVideoToGallery).
    fields: ['prompt', 'description'],
    userFields: ['creatorUid', 'userId', 'uid'],
    kind: (d) => {
      const m = String(d.mediaType ?? '').toLowerCase();
      if (m.includes('video')) return 'video';
      if (m.includes('audio') || m.includes('voice')) return 'audio';
      if (m.includes('3d') || m.includes('model')) return 'threed';
      return 'image';
    },
    modelFields: ['generationModel', 'model'],
    // Only rows that came from a generation — skip plain uploads.
    providerFields: ['provider'],
  },
];

function pick(data: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function toDate(ts: unknown): Date {
  const anyTs = ts as { toDate?: () => Date; seconds?: number; _seconds?: number } | undefined;
  if (anyTs?.toDate) return anyTs.toDate();
  const secs = anyTs?.seconds ?? anyTs?._seconds;
  if (typeof secs === 'number') return new Date(secs * 1000);
  if (ts instanceof Date) return ts;
  const d = new Date(ts as string);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function stableId(collection: string, docId: string, field: string): string {
  const h = createHash('sha256').update(`${collection}:${docId}:${field}`).digest('hex');
  return `pl_bf_${h.slice(0, 32)}`;
}

async function main() {
  const isDryRun = process.env.DRY_RUN === '1';
  const only = (process.env.ONLY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log('\n=== LOAR — Backfill promptLog from generation records ===\n');
  if (isDryRun) console.log('  DRY RUN — no writes\n');

  const { initFirebase } = await import('../apps/server/src/lib/firebase');
  initFirebase();
  const { db } = await import('../apps/server/src/lib/firebase');
  if (!db) {
    console.error('ERROR: Firebase not initialized. Check FIREBASE_SERVICE_ACCOUNT in .env');
    process.exit(1);
  }

  let grandTotal = 0;
  let grandWritten = 0;
  let grandSkipped = 0;

  for (const spec of SOURCES) {
    if (only.length && !only.includes(spec.collection)) continue;

    process.stdout.write(`\n${spec.collection}: reading… `);
    let snap: { size: number; docs: Array<{ id: string; data: () => Record<string, unknown> }> };
    try {
      snap = await db.collection(spec.collection).get();
    } catch (err) {
      console.log(`skip (${(err as Error).message})`);
      continue;
    }
    console.log(`${snap.size} docs`);

    let batch = db.batch();
    let pending = 0;
    let written = 0;
    let skipped = 0;

    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const userId = pick(data, spec.userFields)?.toLowerCase() ?? null;
      const createdAt = toDate(data.createdAt ?? data.created_at ?? data.completedAt);
      const kind = typeof spec.kind === 'function' ? spec.kind(data) : spec.kind;
      const model = spec.modelFields ? pick(data, spec.modelFields) : null;
      const provider = spec.providerFields ? pick(data, spec.providerFields) : null;
      const universeAddress =
        (spec.universeFields ? pick(data, spec.universeFields) : null)?.toLowerCase() ?? null;

      // `content`: only backfill generation-derived rows (has a generationId).
      if (spec.collection === 'content' && !data.generationId && !data.generationModel) {
        continue;
      }

      // De-dupe fields that hold the same text (prompt === originalPrompt).
      const seenText = new Set<string>();
      for (const field of spec.fields) {
        const raw = data[field];
        if (typeof raw !== 'string') continue;
        const text = raw.trim();
        if (text.length < 2 || seenText.has(text)) continue;
        seenText.add(text);

        grandTotal++;
        if (!userId) {
          skipped++;
          continue;
        }

        const iso = createdAt.toISOString();
        const row = {
          userId,
          route: `backfill:${spec.collection}`,
          requestId: null,
          apiKeyId: null,
          aiAgentId: null,
          universeAddress,
          entityId: (data.entityId as string) ?? null,
          kind,
          field,
          prompt: text.slice(0, 20_000),
          promptHash: createHash('sha256').update(text).digest('hex'),
          promptChars: text.length,
          truncated: text.length > 20_000,
          model,
          provider,
          extra: null,
          source: 'backfill' as const,
          backfillFrom: { collection: spec.collection, docId: doc.id, field },
          day: iso.slice(0, 10),
          month: iso.slice(0, 7),
          createdAt,
        };

        if (!isDryRun) {
          batch.set(db.collection('promptLog').doc(stableId(spec.collection, doc.id, field)), row);
          pending++;
          if (pending >= 400) {
            await batch.commit();
            batch = db.batch();
            pending = 0;
          }
        }
        written++;
      }
    }

    if (!isDryRun && pending > 0) await batch.commit();
    console.log(
      `  → ${written} rows${isDryRun ? ' (dry)' : ' written'}, ${skipped} skipped (no user)`
    );
    grandWritten += written;
    grandSkipped += skipped;
  }

  console.log(
    `\nDone. ${grandWritten} rows ${isDryRun ? 'would be written' : 'written'} / ` +
      `${grandTotal} candidates / ${grandSkipped} skipped.\n`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

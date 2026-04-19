/**
 * VLM Worker — processes VLM jobs from the BullMQ `vlm` queue.
 *
 * Runs per-kind dispatch: extract, canon_check, moderation, recap,
 * search_index, governance_draft, copilot_score. Every result is persisted
 * to Firestore; the returned VlmJobResult points at the doc reference so
 * clients polling status know where to read.
 *
 * Usage (standalone):
 *   node --loader tsx apps/server/src/workers/vlm.worker.ts
 *
 * Or import and `startVlmWorker()` from the main server process.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type VlmJobData, type VlmJobResult } from '../lib/queue';

function getConnectionOpts() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required for vlm worker');
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    username: url.username || undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

async function processVlm(job: Job<VlmJobData, VlmJobResult>): Promise<VlmJobResult> {
  const { data } = job;
  const { db } = await import('../lib/firebase');

  const jobRef = db.collection('vlmJobs').doc(data.jobId);
  await jobRef.set(
    {
      jobId: data.jobId,
      kind: data.kind,
      status: 'running',
      creatorUid: data.creatorUid,
      input: data.input,
      startedAt: new Date(),
    },
    { merge: true }
  );
  await job.updateProgress(10);

  try {
    const vlm = await import('../services/vlm');
    let outputRef: string | undefined;
    let tokensUsed = 0;
    let costUsd = 0;

    if (data.kind === 'extract') {
      const { extraction, proposals, sceneIndexRows } = await vlm.runExtraction({
        input: data.input,
        creatorUid: data.creatorUid,
      });
      outputRef = extraction.id;
      tokensUsed = extraction.tokensUsed;
      costUsd = extraction.costUsd;

      // Persist entity proposals
      if (proposals.length) {
        const batch = db.batch();
        for (const p of proposals) {
          const ref = db.collection('entityProposals').doc(p.proposalId);
          batch.set(ref, {
            id: p.proposalId,
            extractionId: extraction.id,
            creatorUid: data.creatorUid,
            universeAddress: extraction.universeAddress ?? null,
            kind: p.kind,
            name: p.name,
            description: p.description,
            metadata: p.metadata ?? {},
            sourceSceneIndexes: p.evidenceSceneIndexes,
            firstSeenAtSec: p.firstSeenAtSec ?? null,
            status: 'pending',
            createdAt: new Date(),
          });
        }
        await batch.commit();
      }
      await job.updateProgress(60);

      // Index scenes for search + run moderation scoring — fire-and-forget.
      const contentId = extraction.contentId;
      if (contentId && sceneIndexRows.length) {
        await vlm.indexScenesForContent({
          contentId,
          universeAddress: extraction.universeAddress,
          rows: sceneIndexRows,
        });
      }
      if (extraction.risks.length) {
        await vlm.runModerationScoring({ extraction, contentId });
      }
      await job.updateProgress(90);
    } else if (data.kind === 'canon_check') {
      const extractionId = String((data.input.options as any)?.extractionId ?? '');
      const universeAddress = data.input.universeAddress;
      const targetId = String((data.input.options as any)?.targetId ?? data.input.contentId ?? '');
      if (!extractionId || !universeAddress || !targetId) {
        throw new Error(
          'canon_check requires options.extractionId, universeAddress, options.targetId'
        );
      }
      const exDoc = await db.collection('vlmExtractions').doc(extractionId).get();
      if (!exDoc.exists) throw new Error(`Extraction ${extractionId} not found`);
      const extraction = exDoc.data() as any;
      const result = await vlm.runCanonCheck({ extraction, universeAddress, targetId });
      outputRef = result.id;
    } else if (data.kind === 'moderation') {
      const extractionId = String((data.input.options as any)?.extractionId ?? '');
      const exDoc = await db.collection('vlmExtractions').doc(extractionId).get();
      if (!exDoc.exists) throw new Error(`Extraction ${extractionId} not found`);
      const extraction = exDoc.data() as any;
      const result = await vlm.runModerationScoring({
        extraction,
        contentId: data.input.contentId,
      });
      outputRef = result?.contentId;
    } else if (data.kind === 'recap') {
      const extractionId = String((data.input.options as any)?.extractionId ?? '');
      let extraction: any = undefined;
      if (extractionId) {
        const d = await db.collection('vlmExtractions').doc(extractionId).get();
        if (d.exists) extraction = d.data();
      }
      const {
        recap,
        tokensUsed: t,
        costUsd: c,
      } = await vlm.runRecap({
        mediaUrl: data.input.mediaUrl,
        assetType: data.input.assetType === 'audio' ? 'video' : data.input.assetType,
        mimeType: data.input.mimeType,
        targetDurationSec: (data.input.options as any)?.targetDurationSec,
        audience: (data.input.options as any)?.audience,
        extraction,
      });
      tokensUsed = t;
      costUsd = c;
      const ref = await db.collection('vlmRecaps').add({
        jobId: data.jobId,
        creatorUid: data.creatorUid,
        contentId: data.input.contentId ?? null,
        recap,
        createdAt: new Date(),
      });
      outputRef = ref.id;
    } else if (data.kind === 'search_index') {
      const extractionId = String((data.input.options as any)?.extractionId ?? '');
      const contentId = data.input.contentId;
      if (!extractionId || !contentId) {
        throw new Error('search_index requires options.extractionId + input.contentId');
      }
      const exDoc = await db.collection('vlmExtractions').doc(extractionId).get();
      if (!exDoc.exists) throw new Error(`Extraction ${extractionId} not found`);
      const extraction = exDoc.data() as any;
      const rows = (extraction.scenes ?? []).map((s: any) => ({
        sceneIndex: s.index,
        caption: s.description,
        tags: Array.from(
          new Set([
            ...(s.actions ?? []).map((a: string) => a.toLowerCase()),
            ...(s.mood ? [String(s.mood).toLowerCase()] : []),
            ...(s.location ? [String(s.location).toLowerCase()] : []),
          ])
        ).slice(0, 30),
        objects: s.subjects ?? [],
        faces: [],
        mood: s.mood ?? '',
        startSec: s.startSec,
        endSec: s.endSec,
      }));
      const count = await vlm.indexScenesForContent({
        contentId,
        universeAddress: extraction.universeAddress ?? null,
        rows,
      });
      outputRef = `${contentId}:${count}`;
    } else if (data.kind === 'governance_draft') {
      const extractionId = String((data.input.options as any)?.extractionId ?? '');
      const universeAddress = data.input.universeAddress;
      if (!extractionId || !universeAddress) {
        throw new Error('governance_draft requires options.extractionId + universeAddress');
      }
      const exDoc = await db.collection('vlmExtractions').doc(extractionId).get();
      if (!exDoc.exists) throw new Error(`Extraction ${extractionId} not found`);
      const extraction = exDoc.data() as any;
      const draft = await vlm.runGovernanceDraft({
        extraction,
        universeAddress,
        creatorUid: data.creatorUid,
      });
      outputRef = draft.id;
    } else if (data.kind === 'copilot_score') {
      const opts = data.input.options as any;
      const res = await vlm.scoreOutput({
        outputUrl: data.input.mediaUrl,
        outputType: data.input.assetType === 'audio' ? 'image' : data.input.assetType,
        intent: String(opts?.intent ?? ''),
        prompt: String(opts?.prompt ?? ''),
        referenceUrls: Array.isArray(opts?.referenceUrls) ? opts.referenceUrls : [],
      });
      costUsd = res.cost.reduce((a, c) => a + c.costUsd, 0);
      tokensUsed = res.cost.reduce((a, c) => a + c.tokensUsed, 0);
      const ref = await db.collection('vlmCopilotScores').add({
        jobId: data.jobId,
        creatorUid: data.creatorUid,
        contentId: data.input.contentId ?? null,
        generationId: data.input.generationId ?? null,
        score: res.score,
        createdAt: new Date(),
      });
      outputRef = ref.id;
    } else {
      throw new Error(`Unknown VLM job kind: ${(data as any).kind}`);
    }

    await job.updateProgress(100);
    await jobRef.set(
      {
        status: 'completed',
        outputRef: outputRef ?? null,
        tokensUsed,
        costUsd,
        completedAt: new Date(),
      },
      { merge: true }
    );
    return { jobId: data.jobId, status: 'completed', outputRef, tokensUsed, costUsd };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'unknown';
    await jobRef.set(
      {
        status: 'failed',
        error,
        completedAt: new Date(),
      },
      { merge: true }
    );
    return { jobId: data.jobId, status: 'failed', error };
  }
}

let worker: Worker<VlmJobData, VlmJobResult> | null = null;

export function startVlmWorker(concurrency?: number): Worker<VlmJobData, VlmJobResult> {
  if (worker) return worker;
  const connection = getConnectionOpts();
  const conc = concurrency ?? parseInt(process.env.VLM_WORKER_CONCURRENCY || '3', 10);
  worker = new Worker<VlmJobData, VlmJobResult>(QUEUE_NAMES.VLM, processVlm, {
    connection,
    concurrency: conc,
    lockDuration: 600_000,
    lockRenewTime: 300_000,
  });
  worker.on('completed', (job: any, result: any) => {
    console.log(`[vlm-worker] Job ${job.id} (${result.jobId}) ${result.status}`);
  });
  worker.on('failed', (job: any, error: Error) => {
    console.error(`[vlm-worker] Job ${job?.id} failed:`, error.message);
  });
  worker.on('error', (error: Error) => {
    console.error('[vlm-worker] worker error:', error);
  });
  console.log(`[vlm-worker] started (concurrency: ${conc})`);
  return worker;
}

export async function stopVlmWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}

if (process.argv[1]?.endsWith('vlm.worker.ts') || process.argv[1]?.endsWith('vlm.worker.js')) {
  const dotenv = await import('dotenv');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
  const { initFirebase } = await import('../lib/firebase');
  initFirebase();
  startVlmWorker();
  const shutdown = async () => {
    console.log('[vlm-worker] shutting down');
    await stopVlmWorker();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

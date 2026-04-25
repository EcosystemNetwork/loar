/**
 * Generation Worker — processes video/image generation jobs from the BullMQ queue.
 *
 * Can be run as a separate process for horizontal scaling:
 *   node --loader tsx apps/server/src/workers/generation.worker.ts
 *
 * Or imported and started within the main server process for simpler deployments.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type GenerationJobData, type GenerationJobResult } from '../lib/queue';
import { getCircuitBreaker, CircuitOpenError } from '../lib/circuit-breaker';
import { recordAiGeneration } from '../lib/metrics';
import { withCostScope } from '../services/cost-tracker/scope';
import { recordProviderCost } from '../services/cost-tracker';

// ── Connection ─────────────────────────────────────────────────────────

function getConnectionOpts() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required for generation worker');

  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    username: url.username || undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

// ── Worker Logic ───────────────────────────────────────────────────────

async function processGenerationBody(
  job: Job<GenerationJobData, GenerationJobResult>
): Promise<GenerationJobResult> {
  const { data } = job;
  const startTime = Date.now();

  // Late imports so env vars are loaded
  const { db } = await import('../lib/firebase');
  const { falService } = await import('../services/fal');
  const { bytedanceService } = await import('../services/bytedance');
  const { getModelById, markProviderHealthy, markProviderUnhealthy } =
    await import('../services/video-models');
  const { getStorageManager } = await import('../services/storage');
  const { signWithProvenance } = await import('../services/provenance');
  const { createAttachment } = await import('../routers/media/media.handlers');
  const { FieldValue } = await import('firebase-admin/firestore');
  const { logFailedRefund } = await import('../lib/refund-audit');
  const { trackQuests, trackModelUsage } = await import('../services/quest-tracker');
  const { translateCameraPreset, applyStyleToPrompt } = await import('../services/scene-controls');

  const model = getModelById(data.finalModelId);
  if (!model) {
    throw new Error(`Model ${data.finalModelId} not found`);
  }

  const generationsCol = db.collection('videoGenerations');
  const breaker = getCircuitBreaker(model.provider);

  // Update status to running
  await job.updateProgress(10);
  await generationsCol.doc(data.generationId).update({ status: 'running' });

  try {
    // Execute generation through circuit breaker
    const result = await breaker.execute(async () => {
      await job.updateProgress(20);

      const input = data.input as any;

      // Apply scene controls
      if (input.stylePreset) {
        input.prompt = applyStyleToPrompt(input.prompt, input.stylePreset);
      }
      if (input.cameraPreset && model.provider !== 'bytedance') {
        const cam = translateCameraPreset(
          model.provider,
          input.cameraPreset,
          input.cameraIntensity || 'standard'
        );
        if (cam.promptSuffix) input.prompt = `${input.prompt}, ${cam.promptSuffix}`;
      }
      if (input.startFrameUrl && !input.imageUrl) {
        input.imageUrl = input.startFrameUrl;
        input.mode = 'image_to_video';
      }

      await job.updateProgress(30);

      // Dispatch to provider
      if (model.provider === 'bytedance') {
        // BYOK — look up the requesting user's stored ByteDance key, if any.
        const { getUserSecret } = await import('../services/userSecrets');
        const bdApiKey = data.userId
          ? ((await getUserSecret(data.userId, 'bytedance')) ?? undefined)
          : undefined;
        return bytedanceService.generateVideo({
          prompt: input.prompt,
          model: model.bytedanceModelId || 'seedance-2.0',
          mode:
            input.mode === 'image_to_video' && input.imageUrl
              ? 'image_to_video'
              : data.resolvedCastUrls?.length
                ? 'reference_to_video'
                : 'text_to_video',
          imageUrl: input.imageUrl,
          duration: input.durationSec,
          aspectRatio: input.aspectRatio,
          resolution: input.resolution,
          audio: input.audio,
          negativePrompt: input.negativePrompt,
          referenceImages: data.resolvedCastUrls?.map((url: string) => ({
            url,
            role: 'subject' as const,
          })),
          endImageUrl: input.endFrameUrl,
          apiKey: bdApiKey,
        });
      }

      return falService.generateVideo({
        prompt: input.prompt,
        model: model.falModelId as any,
        imageUrl: input.imageUrl,
        duration: input.durationSec,
        aspectRatio: input.aspectRatio,
        resolution:
          input.resolution === '720p' || input.resolution === '1080p' || input.resolution === 'auto'
            ? input.resolution
            : undefined,
        negativePrompt: input.negativePrompt,
        motionStrength: input.motionStrength,
        cfgScale: input.cfgScale,
        enablePromptExpansion: input.enablePromptExpansion,
        generateAudio: input.audio && model.supportsAudio ? true : undefined,
      });
    });

    await job.updateProgress(70);
    const latencyMs = Date.now() - startTime;

    if (result.status === 'failed' || result.error || !result.videoUrl) {
      markProviderUnhealthy(model.provider);

      // Refund credits
      if (data.creditsCharged > 0) {
        try {
          await db
            .collection('userCredits')
            .doc(data.userId)
            .update({
              balance: FieldValue.increment(data.creditsCharged),
              totalSpent: FieldValue.increment(-data.creditsCharged),
              updatedAt: new Date(),
            });
          const { recordCreditsTx } = await import('../lib/metrics');
          recordCreditsTx('refund', 'success');
        } catch (refundErr) {
          const { recordCreditsTx } = await import('../lib/metrics');
          recordCreditsTx('refund', 'failure');
          console.error(`CRITICAL: Credit refund failed for ${data.userId}:`, refundErr);
          logFailedRefund({
            userId: data.userId,
            credits: data.creditsCharged,
            source: 'generation.worker',
            generationId: data.generationId,
            error: refundErr instanceof Error ? refundErr.message : 'Unknown',
          });
        }
      }

      await generationsCol.doc(data.generationId).update({
        status: 'failed',
        failureReason: result.error || 'Generation failed',
        latencyMs,
        completedAt: new Date(),
      });

      recordAiGeneration(model.provider, 'video', 'failure', latencyMs / 1000);

      void import('../lib/analytics').then(({ captureServerEvent }) =>
        captureServerEvent('generation:failed', {
          distinctId: data.userId,
          generationId: data.generationId,
          provider: model.provider,
          kind: 'video',
          modelId: data.finalModelId,
          latencyMs,
          reason: 'provider_failed',
          error: (result.error || 'Generation failed').slice(0, 200),
        })
      );

      return {
        generationId: data.generationId,
        status: 'failed',
        wasFallback: false,
        latencyMs,
        error: result.error || 'Generation failed',
      };
    }

    // Success
    markProviderHealthy(model.provider);
    await job.updateProgress(80);

    // Rehost to permanent storage (IPFS/Filecoin) BEFORE writing the content
    // doc, so the gallery never points to an ephemeral provider URL that will
    // 403 when the short-lived signed URL expires.
    let permanentUrl: string | null = null;
    let storageContentHash: string | null = null;
    try {
      const manager = getStorageManager();
      const filename = `generation-${data.generationId}.mp4`;
      const response = await fetch(result.videoUrl!);
      const arrayBuf = await response.arrayBuffer();
      const rawBuffer: Buffer = Buffer.from(new Uint8Array(arrayBuf));

      const videoBuffer = await signWithProvenance(rawBuffer, filename, {
        model: data.finalModelId,
        prompt: data.originalPrompt,
        generatedAt: new Date().toISOString(),
        mimeType: 'video/mp4',
      });

      const manifest = await manager.upload(videoBuffer, filename, 'video/mp4', data.userId);
      permanentUrl = manifest.uploads[0]?.url ?? null;
      storageContentHash = manifest.contentHash;
    } catch (err) {
      console.error(`[worker] storage persist failed for ${data.generationId}:`, err);
      // Fall through — content doc will use the ephemeral URL rather than fail the job.
    }

    const finalMediaUrl = permanentUrl ?? result.videoUrl!;

    // Record provider spend to the cost ledger. The admission layer already
    // computed the per-job providerCostUsd from the model's rate card; we
    // log it against the originating user + universe for margin tracking.
    if (data.providerCostUsd > 0) {
      await recordProviderCost({
        provider: (model.provider as any) === 'bytedance' ? 'bytedance' : 'fal',
        model: data.finalModelId,
        kind: 'video_gen',
        costUsd: data.providerCostUsd,
        extra: {
          generationId: data.generationId,
          latencyMs,
          creditsCharged: data.creditsCharged,
          fiatPriceUsd: data.fiatPriceUsd,
          loarPriceUsd: data.loarPriceUsd,
        },
      });
    }

    await generationsCol.doc(data.generationId).update({
      status: 'completed',
      videoUrl: finalMediaUrl,
      ephemeralVideoUrl: result.videoUrl, // kept for debugging / provenance audit
      ...(permanentUrl ? { permanentVideoUrl: permanentUrl } : {}),
      ...(storageContentHash ? { storageContentHash, storagePersisted: true } : {}),
      latencyMs,
      completedAt: new Date(),
    });

    // Fire background tasks (best-effort, non-blocking)
    // Auto-attach to entity
    if (data.input.entityId) {
      try {
        const entityDoc = await db.collection('entities').doc(data.input.entityId).get();
        if (entityDoc.exists && entityDoc.data()?.creator === data.userId) {
          await createAttachment(data.userId, {
            contentHash: `gen:${data.generationId}:video`,
            originalFilename: `generation-${data.generationId}.mp4`,
            mimeType: 'video/mp4',
            size: 0,
            url: result.videoUrl!,
            targetType: 'entity',
            targetId: data.input.entityId,
            targetName: entityDoc.data()?.name ?? '',
            category: 'video',
            label: data.originalPrompt.slice(0, 80),
            generationId: data.generationId,
          });
        }
      } catch (err) {
        console.error('Failed to auto-attach video:', err);
      }
    }

    await job.updateProgress(90);

    // Auto-publish to gallery — use the permanent URL when rehost succeeded
    // so the gallery doc never stores an expiring provider URL.
    let contentDocId: string | null = null;
    try {
      const contentRef = await db.collection('content').add({
        title: (data.originalPrompt || '').slice(0, 100) || 'Generated Video',
        description: data.originalPrompt || '',
        mediaUrl: finalMediaUrl,
        thumbnailUrl: data.input.imageUrl || null,
        mediaType: 'ai-video',
        classification: 'original',
        tags: [],
        ipDeclaration: {
          isOriginal: true,
          usesCopyrightedMaterial: false,
          license: 'all-rights-reserved',
        },
        visibility: 'public',
        creatorUid: data.userId,
        ...(data.input.universeId ? { universeId: data.input.universeId } : {}),
        createdAt: new Date(),
        updatedAt: new Date(),
        views: 0,
        likes: 0,
        reviewStatus: 'not_required',
        generationId: data.generationId,
        generationModel: data.finalModelId,
        ...(storageContentHash ? { storageContentHash } : {}),
      });
      contentDocId = contentRef.id;
    } catch (err) {
      console.error('[worker] gallery publish failed:', err);
    }

    // Enqueue VLM extraction + moderation — runs asynchronously, writes
    // vlmExtractions/ + flags/ + (optionally) contentStatus='under_review'.
    // Gated by VLM_MODERATION_ON_GENERATION=true because a per-generation
    // Gemini pass adds real cost. Turn on before mainnet.
    if (contentDocId && process.env.VLM_MODERATION_ON_GENERATION === 'true') {
      try {
        const { getVlmQueue } = await import('../lib/queue');
        const { randomUUID } = await import('node:crypto');
        const jobId = `vlm_${randomUUID()}`;
        await getVlmQueue().add(
          'extract',
          {
            jobId,
            kind: 'extract',
            creatorUid: data.userId,
            input: {
              assetType: 'video',
              mediaUrl: finalMediaUrl,
              mimeType: 'video/mp4',
              contentId: contentDocId,
              generationId: data.generationId,
              universeAddress: data.input.universeId ?? null,
            },
          },
          { jobId }
        );
      } catch (err) {
        console.warn('[worker] VLM moderation enqueue failed:', err);
      }
    }

    // Track quests
    try {
      await trackQuests(data.userId, [
        { questId: 'first_generation' },
        { questId: 'daily_generation' },
        { questId: 'generate_5_videos' },
        { questId: 'generate_100_videos' },
        ...(data.input.routingMode === 'auto' ? [{ questId: 'smart_auto_10' }] : []),
      ]);
      await trackModelUsage(data.userId, data.finalModelId);
    } catch {
      // Best-effort
    }

    // Auto-enqueue VLM extraction post-success so every new asset gets a
    // scene index + moderation risk score. Non-blocking — failure here
    // does not affect the generation result.
    if (process.env.GOOGLE_API_KEY && process.env.VLM_AUTO_EXTRACT !== 'false' && finalMediaUrl) {
      try {
        const { randomUUID } = await import('node:crypto');
        const { getVlmQueue } = await import('../lib/queue');
        const jobId = `vlm_${randomUUID()}`;
        const vlmInput = {
          assetType: 'video' as const,
          mediaUrl: finalMediaUrl,
          contentId: data.generationId,
          generationId: data.generationId,
          universeAddress: data.input.universeId ?? null,
          options: { model: 'gemini-2.5-flash' },
        };
        await db.collection('vlmJobs').doc(jobId).set({
          jobId,
          kind: 'extract',
          status: 'pending',
          creatorUid: data.userId.toLowerCase(),
          input: vlmInput,
          createdAt: new Date(),
        });
        await getVlmQueue().add(
          'extract',
          {
            jobId,
            kind: 'extract',
            creatorUid: data.userId.toLowerCase(),
            scope: {
              userId: data.userId.toLowerCase(),
              apiKeyId: null,
              aiAgentId: null,
              universeAddress: data.input.universeId ?? null,
              route: 'worker:generation-post-hook',
              requestId: jobId,
            },
            input: vlmInput,
          },
          { jobId }
        );
      } catch (err) {
        console.error('[worker] VLM auto-extract enqueue failed:', err);
      }
    }

    await job.updateProgress(100);

    recordAiGeneration(model.provider, 'video', 'success', latencyMs / 1000);

    // PostHog: generation:completed closes the creator-success funnel
    // (signup → login → admitted → completed → published). Latency on the
    // event lets us analyse slow-generation impact on retention.
    void import('../lib/analytics').then(({ captureServerEvent }) =>
      captureServerEvent('generation:completed', {
        distinctId: data.userId,
        generationId: data.generationId,
        provider: model.provider,
        kind: 'video',
        modelId: data.finalModelId,
        latencyMs,
        creditsCharged: data.creditsCharged,
      })
    );

    return {
      generationId: data.generationId,
      status: 'completed',
      videoUrl: result.videoUrl,
      wasFallback: false,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    if (error instanceof CircuitOpenError) {
      // Don't count circuit-open as a job failure — just requeue with delay.
      // Record the timeout status so Grafana can distinguish provider-unhealthy
      // retries from real failures.
      recordAiGeneration(model.provider, 'video', 'timeout', latencyMs / 1000);
      throw error; // BullMQ will retry after backoff
    }

    // Refund credits on unexpected failure
    if (data.creditsCharged > 0) {
      try {
        await db
          .collection('userCredits')
          .doc(data.userId)
          .update({
            balance: FieldValue.increment(data.creditsCharged),
            totalSpent: FieldValue.increment(-data.creditsCharged),
            updatedAt: new Date(),
          });
        const { recordCreditsTx } = await import('../lib/metrics');
        recordCreditsTx('refund', 'success');
      } catch (refundErr) {
        const { recordCreditsTx } = await import('../lib/metrics');
        recordCreditsTx('refund', 'failure');
        console.error(`CRITICAL: Credit refund failed for ${data.userId}:`, refundErr);
        logFailedRefund({
          userId: data.userId,
          credits: data.creditsCharged,
          source: 'generation.worker',
          generationId: data.generationId,
          error: refundErr instanceof Error ? refundErr.message : 'Unknown',
        });
      }
    }

    await generationsCol.doc(data.generationId).update({
      status: 'failed',
      failureReason: error instanceof Error ? error.message : 'Unknown error',
      latencyMs,
      completedAt: new Date(),
    });

    recordAiGeneration(model.provider, 'video', 'failure', latencyMs / 1000);

    void import('../lib/analytics').then(({ captureServerEvent }) =>
      captureServerEvent('generation:failed', {
        distinctId: data.userId,
        generationId: data.generationId,
        provider: model.provider,
        kind: 'video',
        modelId: data.finalModelId,
        latencyMs,
        reason: 'exception',
        error: (error instanceof Error ? error.message : 'Unknown error').slice(0, 200),
      })
    );

    return {
      generationId: data.generationId,
      status: 'failed',
      wasFallback: false,
      latencyMs,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ── Worker Instance ────────────────────────────────────────────────────

let worker: Worker<GenerationJobData, GenerationJobResult> | null = null;

/**
 * Start the generation worker. Can be called from the main server process
 * or run as a standalone process.
 */
export function startGenerationWorker(
  concurrency = 5
): Worker<GenerationJobData, GenerationJobResult> {
  if (worker) return worker;

  const connection = getConnectionOpts();

  // Wrap body in the attribution scope so any provider call during processing
  // records against the originating user + universe, not 'system'.
  const processGeneration = (job: Job<GenerationJobData, GenerationJobResult>) => {
    const rootScope = {
      userId: job.data.userId ?? null,
      apiKeyId: null,
      aiAgentId: null,
      universeAddress: job.data.input?.universeId ?? null,
      route: `worker:generation:${job.data.provider}`,
      requestId: job.data.generationId,
    };
    return Promise.resolve(withCostScope(rootScope, () => processGenerationBody(job)));
  };

  worker = new Worker<GenerationJobData, GenerationJobResult>(
    QUEUE_NAMES.GENERATION,
    processGeneration,
    {
      connection,
      concurrency,
      // Long-running jobs — 10 minute timeout (video gen can take 5 min)
      lockDuration: 600_000,
      lockRenewTime: 300_000,
    }
  );

  worker.on('completed', (job: any, result: any) => {
    console.log(`[worker] Job ${job.id} (${result.generationId}) completed: ${result.status}`);
  });

  worker.on('failed', (job: any, error: Error) => {
    console.error(`[worker] Job ${job?.id} failed:`, error.message);
  });

  worker.on('error', (error: Error) => {
    console.error('[worker] Worker error:', error);
  });

  console.log(`[worker] Generation worker started (concurrency: ${concurrency})`);
  return worker;
}

export async function stopGenerationWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
  console.log('[worker] Generation worker stopped');
}

// ── Standalone entry point ─────────────────────────────────────────────

if (
  process.argv[1]?.endsWith('generation.worker.ts') ||
  process.argv[1]?.endsWith('generation.worker.js')
) {
  // Running as standalone process
  const dotenv = await import('dotenv');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

  const { initFirebase } = await import('../lib/firebase');
  initFirebase();

  const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
  startGenerationWorker(concurrency);

  const shutdown = async () => {
    console.log('[worker] Shutting down...');
    await stopGenerationWorker();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

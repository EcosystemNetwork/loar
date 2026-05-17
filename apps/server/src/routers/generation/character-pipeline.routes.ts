/**
 * Character Pipeline Router
 *
 * End-to-end character creation pipeline:
 *   1. Create entity in Firestore
 *   2. Generate 2D character art via Google Imagen 3
 *   3. Convert to 3D model via Meshy image-to-3D
 *   4. Apply rich textures via Meshy text-to-texture
 *
 * Each step can also be called independently. The full pipeline
 * is long-running (~5-15 min) and uses polling for 3D steps.
 *
 * Pricing (approximate):
 *   Google Imagen 3     ~$0.04/image
 *   Meshy image-to-3D   ~$0.15/task
 *   Meshy text-to-texture ~$0.15/task
 *   Total pipeline      ~$0.34
 */
import { router, protectedProcedure, expensiveProcedure } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { googleImagenService } from '../../services/google-imagen';
import { meshyService } from '../../services/meshy';
import { createEntity } from '../entities/entities.handlers';
import { createAttachment } from '../media/media.handlers';
import { getStorageManager } from '../../services/storage';
import { FieldValue } from 'firebase-admin/firestore';
import { logFailedRefund } from '../../lib/refund-audit';
import { publishToGallery } from '../../lib/gallery-publish';
import { reserveClientToken } from '../../lib/jobIdempotency';
import { fireJobWebhook, validateWebhookUrl, webhookUrlSchema } from '../../lib/webhooks';
import { TRPCError } from '@trpc/server';
import { withReservation } from '../../services/credits';

// ── Collections ──────────────────────────────────────────────────────

const pipelinesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('characterPipelines');
};
const userCreditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};

// ── Pricing ──────────────────────────────────────────────────────────

const LOAR_TO_USD = 0.01;
const FIAT_MARGIN = 1.35;

const COSTS = {
  imagen_2d: 0.04,
  meshy_image_to_3d: 0.15,
  meshy_texture: 0.15,
};
const TOTAL_PIPELINE_COST = COSTS.imagen_2d + COSTS.meshy_image_to_3d + COSTS.meshy_texture;

function toCredits(usd: number) {
  return Math.ceil((usd * FIAT_MARGIN) / LOAR_TO_USD);
}

// ── Credit helpers ───────────────────────────────────────────────────
//
// The synchronous mutation reserves credits via `withReservation` and
// reconciles them when the background `executePipeline` task is dispatched.
// `executePipeline` runs hours later and needs a post-reconcile refund path
// when a step fails downstream — implemented below with a raw
// `FieldValue.increment`.

async function refundCreditsAfterReconcile(
  userId: string,
  credits: number,
  pipelineId: string
): Promise<void> {
  const ref = userCreditsCol().doc(userId);
  const { recordCreditsTx, recordAiGeneration } = await import('../../lib/metrics');
  try {
    await ref.update({
      balance: FieldValue.increment(credits),
      totalSpent: FieldValue.increment(-credits),
      updatedAt: new Date(),
    });
    recordCreditsTx('refund', 'success');
  } catch (err) {
    recordCreditsTx('refund', 'failure');
    console.error(`CRITICAL: Pipeline credit refund failed for ${userId}:`, err);
    logFailedRefund({
      userId,
      credits,
      source: 'characterPipeline',
      generationId: pipelineId,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
  recordAiGeneration('multi', 'characterPipeline', 'failure');
}

// ── Upload base64 image to storage and get a URL ─────────────────────

async function uploadBase64Image(
  base64: string,
  filename: string,
  userId: string
): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  const manager = getStorageManager();
  const manifest = await manager.upload(buffer, filename, 'image/png', userId);
  const url = manifest.uploads[0]?.url;
  if (!url) throw new Error('Failed to upload image to storage');
  return url;
}

// ── Pipeline status updater ──────────────────────────────────────────

async function updatePipeline(pipelineId: string, update: Record<string, unknown>) {
  await pipelinesCol()
    .doc(pipelineId)
    .update({ ...update, updatedAt: new Date() });
}

// ── Background pipeline executor ─────────────────────────────────────

async function executePipeline(opts: {
  pipelineId: string;
  userId: string;
  entityId: string;
  entityName: string;
  entityDescription: string;
  characterStyle: string;
  artStyle: string;
  texturePrompt: string;
  credits: number;
  universeAddress?: string | null;
  webhookUrl?: string;
  clientToken?: string;
}) {
  const {
    pipelineId,
    userId,
    entityId,
    entityName,
    entityDescription,
    characterStyle,
    artStyle,
    texturePrompt,
    credits,
    universeAddress,
    webhookUrl,
    clientToken,
  } = opts;

  try {
    // BYOK keys for the whole pipeline (user-supplied → env fallback)
    const { resolveProviderKey } = await import('../../lib/byok');
    const [googleKey, meshyKey] = await Promise.all([
      resolveProviderKey(userId, 'google'),
      resolveProviderKey(userId, 'meshy'),
    ]);

    // ── Step 1: Generate 2D character art via Google Imagen ──────────
    console.log(`[pipeline ${pipelineId}] Step 1: Generating 2D art with Google Imagen...`);
    await updatePipeline(pipelineId, {
      currentStep: 'imagen_2d',
      stepProgress: 'Generating 2D character art with Google Imagen 3...',
    });

    const imagenResult = await googleImagenService.generateCharacterPortrait({
      name: entityName,
      description: entityDescription,
      style: characterStyle as any,
      apiKey: googleKey,
    });

    if (!imagenResult.images.length) {
      throw new Error('Google Imagen returned no images');
    }

    // Upload the generated image to permanent storage
    const imageFilename = `character-${pipelineId}.png`;
    const imageUrl = await uploadBase64Image(imagenResult.images[0].base64, imageFilename, userId);

    // Update entity with the generated image
    await db.collection('entities').doc(entityId).update({
      imageUrl,
      updatedAt: new Date(),
    });

    // Attach the 2D image to the entity
    await createAttachment(userId, {
      contentHash: `pipeline:${pipelineId}:2d`,
      originalFilename: imageFilename,
      mimeType: 'image/png',
      size: 0,
      url: imageUrl,
      targetType: 'entity',
      targetId: entityId,
      targetName: entityName,
      category: 'image',
      label: 'Character portrait (Google Imagen 3)',
      subCategory: 'concept_art',
      generationId: pipelineId,
    }).catch((err) => console.error('[pipeline] 2D attach failed:', err));

    void publishToGallery({
      creatorUid: userId,
      mediaUrl: imageUrl,
      thumbnailUrl: imageUrl,
      mediaType: 'ai-image',
      title: `${entityName} — concept art`,
      description: entityDescription,
      universeId: universeAddress || null,
      generationId: `${pipelineId}:2d`,
      generationModel: 'google-imagen-3',
      tags: ['character', 'concept-art', characterStyle],
    });

    await updatePipeline(pipelineId, {
      currentStep: 'imagen_2d_complete',
      imageUrl,
      stepProgress: '2D character art generated successfully',
    });

    console.log(`[pipeline ${pipelineId}] Step 1 complete: ${imageUrl}`);

    // ── Step 2: Convert 2D to 3D via Meshy image-to-3D ──────────────
    console.log(`[pipeline ${pipelineId}] Step 2: Converting to 3D with Meshy...`);
    await updatePipeline(pipelineId, {
      currentStep: 'meshy_3d',
      stepProgress: 'Converting 2D art to 3D model with Meshy...',
    });

    const { taskId: meshyTaskId } = await meshyService.imageTo3D({
      imageUrl,
      enablePbr: false,
      aiModel: 'meshy-6',
      topology: 'triangle',
      targetPolycount: 15000,
      apiKey: meshyKey,
    });

    await updatePipeline(pipelineId, {
      meshy3dTaskId: meshyTaskId,
      stepProgress: `3D conversion in progress (task: ${meshyTaskId})...`,
    });

    // Wait for 3D model to complete (up to 25 min)
    const meshyTask = await meshyService.waitForTask(
      meshyTaskId,
      'image-to-3d',
      25 * 60 * 1000,
      undefined,
      meshyKey
    );

    const glbUrl = meshyTask.modelUrls?.glb;
    if (!glbUrl) throw new Error('Meshy 3D conversion did not return a GLB model');

    // Attach 3D model files to entity
    const modelFormats: [string, string | undefined][] = [
      ['glb', meshyTask.modelUrls?.glb],
      ['fbx', meshyTask.modelUrls?.fbx],
      ['obj', meshyTask.modelUrls?.obj],
      ['usdz', meshyTask.modelUrls?.usdz],
    ];

    for (const [format, url] of modelFormats) {
      if (!url) continue;
      await createAttachment(userId, {
        contentHash: `pipeline:${pipelineId}:3d:${format}`,
        originalFilename: `model.${format}`,
        mimeType: format === 'glb' ? 'model/gltf-binary' : `model/${format}`,
        size: 0,
        url,
        targetType: 'entity',
        targetId: entityId,
        targetName: entityName,
        category: '3d',
        label: `3D model (untextured) — ${format.toUpperCase()}`,
        subCategory: 'game_ready',
        generationId: pipelineId,
      }).catch((err) => console.error(`[pipeline] 3D ${format} attach failed:`, err));
    }

    if (meshyTask.thumbnailUrl) {
      await createAttachment(userId, {
        contentHash: `pipeline:${pipelineId}:3d:thumbnail`,
        originalFilename: 'thumbnail-3d.png',
        mimeType: 'image/png',
        size: 0,
        url: meshyTask.thumbnailUrl,
        targetType: 'entity',
        targetId: entityId,
        targetName: entityName,
        category: 'image',
        label: '3D model thumbnail',
        subCategory: 'concept_art',
        generationId: pipelineId,
      }).catch((err) => console.error('[pipeline] 3D thumbnail attach failed:', err));
    }

    // Untextured GLB is an intermediate — it stays as an entity attachment
    // (for raw-asset download) but is NOT published to gallery. Only the
    // textured result below reaches the wiki.

    await updatePipeline(pipelineId, {
      currentStep: 'meshy_3d_complete',
      modelUrls: meshyTask.modelUrls,
      thumbnailUrl: meshyTask.thumbnailUrl,
      videoUrl: meshyTask.videoUrl,
      stepProgress: '3D model generated successfully',
    });

    console.log(`[pipeline ${pipelineId}] Step 2 complete: GLB at ${glbUrl}`);

    // ── Step 3: Apply textures via Meshy text-to-texture ────────────
    console.log(`[pipeline ${pipelineId}] Step 3: Texturing with Meshy...`);
    await updatePipeline(pipelineId, {
      currentStep: 'meshy_texture',
      stepProgress: 'Applying AI textures to 3D model...',
    });

    let fullTexturePrompt =
      texturePrompt ||
      `${entityName}, ${entityDescription}, ${artStyle} style, detailed PBR textures, high quality materials`;
    // Meshy retexture caps text_style_prompt at 800 chars
    if (fullTexturePrompt.length > 800) fullTexturePrompt = fullTexturePrompt.slice(0, 797) + '...';

    const { taskId: textureTaskId } = await meshyService.textToTexture({
      modelUrl: glbUrl,
      prompt: fullTexturePrompt,
      artStyle: (artStyle as any) || 'realistic',
      enablePbr: true,
      resolution: 2048,
      apiKey: meshyKey,
    });

    await updatePipeline(pipelineId, {
      meshyTextureTaskId: textureTaskId,
      stepProgress: `Texturing in progress (task: ${textureTaskId})...`,
    });

    // Wait for texture task to complete (up to 20 min)
    const textureTask = await meshyService.waitForTextureTask(
      textureTaskId,
      20 * 60 * 1000,
      undefined,
      meshyKey
    );

    // Attach textured model files
    const texturedFormats: [string, string | undefined][] = [
      ['glb', textureTask.modelUrls?.glb],
      ['fbx', textureTask.modelUrls?.fbx],
      ['obj', textureTask.modelUrls?.obj],
      ['usdz', textureTask.modelUrls?.usdz],
    ];

    for (const [format, url] of texturedFormats) {
      if (!url) continue;
      await createAttachment(userId, {
        contentHash: `pipeline:${pipelineId}:textured:${format}`,
        originalFilename: `textured-model.${format}`,
        mimeType: format === 'glb' ? 'model/gltf-binary' : `model/${format}`,
        size: 0,
        url,
        targetType: 'entity',
        targetId: entityId,
        targetName: entityName,
        category: '3d',
        label: `Textured 3D model — ${format.toUpperCase()}`,
        subCategory: 'game_ready',
        generationId: pipelineId,
      }).catch((err) => console.error(`[pipeline] textured ${format} attach failed:`, err));
    }

    if (textureTask.thumbnailUrl) {
      await createAttachment(userId, {
        contentHash: `pipeline:${pipelineId}:textured:thumbnail`,
        originalFilename: 'thumbnail-textured.png',
        mimeType: 'image/png',
        size: 0,
        url: textureTask.thumbnailUrl,
        targetType: 'entity',
        targetId: entityId,
        targetName: entityName,
        category: 'image',
        label: 'Textured 3D model thumbnail',
        subCategory: 'concept_art',
        generationId: pipelineId,
      }).catch((err) => console.error('[pipeline] textured thumbnail attach failed:', err));
    }

    const texturedGlbUrl = textureTask.modelUrls?.glb;
    if (texturedGlbUrl) {
      void publishToGallery({
        creatorUid: userId,
        mediaUrl: texturedGlbUrl,
        thumbnailUrl: textureTask.thumbnailUrl || meshyTask.thumbnailUrl || imageUrl,
        mediaType: '3d',
        title: `${entityName} — 3D model`,
        description: entityDescription,
        universeId: universeAddress || null,
        generationId: `${pipelineId}:textured`,
        generationModel: 'meshy-text-to-texture',
        tags: ['character', '3d', 'textured', artStyle],
        parentGenerationId: `${pipelineId}:2d`,
        sourceImageUrl: imageUrl,
      });
    }

    // Turntable preview of the textured model — published as a video so
    // users can see the rotating PBR result in the wiki gallery.
    if (textureTask.videoUrl) {
      void publishToGallery({
        creatorUid: userId,
        mediaUrl: textureTask.videoUrl,
        thumbnailUrl: textureTask.thumbnailUrl || imageUrl,
        mediaType: 'video',
        title: `${entityName} — 3D turntable`,
        description: `Rotating preview of ${entityName}'s 3D model.`,
        universeId: universeAddress || null,
        generationId: `${pipelineId}:turntable`,
        generationModel: 'meshy-text-to-texture',
        tags: ['character', '3d', 'turntable', artStyle],
        parentGenerationId: `${pipelineId}:textured`,
      });
    }

    await updatePipeline(pipelineId, {
      currentStep: 'completed',
      status: 'completed',
      texturedModelUrls: textureTask.modelUrls,
      texturedThumbnailUrl: textureTask.thumbnailUrl,
      texturedVideoUrl: textureTask.videoUrl,
      stepProgress: 'Character pipeline complete!',
      completedAt: new Date(),
    });

    console.log(`[pipeline ${pipelineId}] Pipeline complete!`);

    fireJobWebhook({
      ownerUid: userId,
      webhookUrl,
      clientToken,
      event: 'job.completed',
      jobId: pipelineId,
      kind: '3d',
      payload: {
        operation: 'characterPipeline',
        status: 'completed',
        entityId,
        entityName,
        texturedModelUrls: textureTask.modelUrls ?? null,
        texturedThumbnailUrl: textureTask.thumbnailUrl ?? null,
        texturedVideoUrl: textureTask.videoUrl ?? null,
        creditsCharged: credits,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[pipeline ${pipelineId}] Failed:`, error);

    await refundCreditsAfterReconcile(userId, credits, pipelineId);

    await updatePipeline(pipelineId, {
      status: 'failed',
      creditsRefunded: true,
      failureReason: errorMessage,
      completedAt: new Date(),
    }).catch(() => {});

    fireJobWebhook({
      ownerUid: userId,
      webhookUrl,
      clientToken,
      event: 'job.failed',
      jobId: pipelineId,
      kind: '3d',
      payload: {
        operation: 'characterPipeline',
        status: 'failed',
        errorMessage,
        creditsRefunded: true,
      },
    });
  }
}

// ── Router ────────────────────────────────────────────────────────────

const characterStyleSchema = z
  .enum(['realistic', 'stylized', 'anime', 'fantasy', 'sci-fi'])
  .default('realistic');
const artStyleSchema = z
  .enum(['realistic', 'cartoon', 'low-poly', 'sculpture', 'pbr'])
  .default('realistic');

export const characterPipelineRouter = router({
  /**
   * Launch the full character pipeline:
   *   entity → 2D (Google Imagen) → 3D (Meshy) → textured 3D (Meshy)
   *
   * Returns immediately with a pipeline ID — poll `getStatus` for progress.
   */
  // INF-6: full character pipeline — Imagen + Meshy + textures (~$0.34 per call).
  // Highest-cost path; per-key concurrency slot required.
  launch: expensiveProcedure
    .input(
      z.object({
        // Entity fields
        name: z.string().min(1).max(200),
        description: z.string().min(1).max(2000),
        kind: z.enum(['person', 'species', 'vehicle', 'technology', 'thing']).default('person'),
        universeAddress: z.string().optional(),
        metadata: z.record(z.string(), z.string()).optional(),

        // 2D generation
        characterStyle: characterStyleSchema,

        // 3D texturing
        artStyle: artStyleSchema,
        texturePrompt: z.string().max(1000).optional(),

        // Idempotency + webhook
        clientToken: z
          .string()
          .min(16)
          .max(128)
          .regex(/^[A-Za-z0-9_-]+$/, 'clientToken must match [A-Za-z0-9_-]{16,128}')
          .optional(),
        webhookUrl: webhookUrlSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify services are configured
      if (!googleImagenService.isConfigured()) {
        throw new Error('Google Imagen is not configured (GOOGLE_API_KEY missing)');
      }
      if (!meshyService.isConfigured()) {
        throw new Error('Meshy is not configured (MESHY_API_KEY missing)');
      }

      const pipelineId = randomUUID();
      const totalCredits = toCredits(TOTAL_PIPELINE_COST);

      // Idempotency — pipeline is ~600s + expensive, retry safety is important.
      if (input.clientToken) {
        const reservation = await reserveClientToken({
          ownerUid: ctx.user.uid,
          clientToken: input.clientToken,
          jobId: pipelineId,
          procedure: 'characterPipeline.launch',
        });
        if (reservation?.existing) {
          const existing = await pipelinesCol().doc(reservation.existing.jobId).get();
          const d = existing.exists ? (existing.data() as any) : {};
          return {
            pipelineId: reservation.existing.jobId,
            entityId: (d.entityId ?? null) as string | null,
            status: (d.status ?? 'running') as 'queued' | 'running' | 'completed' | 'failed',
            creditsCharged: (d.creditsCharged ?? 0) as number,
            estimatedSteps: [] as any[],
            idempotentReplay: true as const,
          };
        }
      }

      // Validate webhookUrl.
      let validatedWebhookUrl: string | undefined;
      if (input.webhookUrl) {
        const check = validateWebhookUrl(input.webhookUrl);
        if (!check.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });
        }
        validatedWebhookUrl = check.url;
      }

      // ── Create entity ──────────────────────────────────────────────
      const { id: entityId, data: entity } = await createEntity(
        {
          name: input.name,
          description: input.description,
          kind: input.kind,
          universeAddress: input.universeAddress || null,
          metadata: input.metadata || {},
        },
        ctx.user.uid
      );

      // ── Save pipeline record ───────────────────────────────────────
      await pipelinesCol()
        .doc(pipelineId)
        .set({
          id: pipelineId,
          userId: ctx.user.uid,
          entityId,
          entityName: input.name,
          characterStyle: input.characterStyle,
          artStyle: input.artStyle,
          texturePrompt: input.texturePrompt || null,
          providerCostUsd: TOTAL_PIPELINE_COST,
          creditsCharged: totalCredits,
          status: 'running',
          currentStep: 'queued',
          stepProgress: 'Starting character pipeline...',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(validatedWebhookUrl ? { webhookUrl: validatedWebhookUrl } : {}),
          ...(input.clientToken ? { clientToken: input.clientToken } : {}),
        });

      // ── Reserve credits via the shared helper, then launch the background
      //    pipeline. The reservation is reconciled immediately on success of
      //    the synchronous launch — post-launch step failures use
      //    `refundCreditsAfterReconcile` (see `executePipeline`).
      return withReservation(
        {
          userId: ctx.user.uid,
          modelId: 'character-pipeline',
          provider: 'multi',
          estimatedCredits: totalCredits,
          byok: false,
          meta: { generationId: pipelineId, entityId },
        },
        async () => {
          // ── Launch pipeline in background ──────────────────────────────
          // Webhook fires from inside executePipeline on terminal state.
          executePipeline({
            pipelineId,
            userId: ctx.user.uid,
            entityId,
            entityName: input.name,
            entityDescription: input.description,
            characterStyle: input.characterStyle,
            artStyle: input.artStyle,
            texturePrompt: input.texturePrompt || '',
            credits: totalCredits,
            universeAddress: input.universeAddress || null,
            webhookUrl: validatedWebhookUrl,
            clientToken: input.clientToken,
          }).catch((err) =>
            console.error(`[pipeline] Background pipeline ${pipelineId} unhandled:`, err)
          );

          return {
            result: {
              pipelineId,
              entityId: entityId as string | null,
              status: 'running' as const,
              creditsCharged: totalCredits,
              estimatedSteps: [
                {
                  step: 'imagen_2d',
                  label: 'Generate 2D character art (Google Imagen 3)',
                  estimateSeconds: 15,
                },
                {
                  step: 'meshy_3d',
                  label: 'Convert to 3D model (Meshy)',
                  estimateSeconds: 300,
                },
                {
                  step: 'meshy_texture',
                  label: 'Apply AI textures (Meshy)',
                  estimateSeconds: 300,
                },
              ],
              idempotentReplay: false as const,
            },
          };
        }
      );
    }),

  /**
   * Poll pipeline status. Returns current step, progress, and any URLs
   * generated so far.
   */
  getStatus: protectedProcedure.input(z.object({ pipelineId: z.string() })).query(
    async ({
      input,
      ctx,
    }): Promise<{
      id: string;
      status: 'queued' | 'running' | 'completed' | 'failed';
      currentStep: string;
      stepProgress?: string;
      failureReason?: string;
      creditsRefunded?: boolean;
      entityId?: string;
      imageUrl?: string;
      meshyTaskId?: string;
      modelUrl?: string;
      textureTaskId?: string;
      texturedModelUrl?: string;
      creditsCharged?: number;
      createdAt?: any;
      updatedAt?: any;
    } | null> => {
      const doc = await pipelinesCol().doc(input.pipelineId).get();
      if (!doc.exists) return null;
      const data = doc.data()!;
      if (data.userId !== ctx.user.uid) throw new Error('Not authorized');
      return { id: doc.id, ...data } as any;
    }
  ),

  /**
   * List user's pipeline history.
   */
  history: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      const snapshot = await pipelinesCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  /**
   * Estimate the total pipeline cost before launching.
   */
  estimateCost: protectedProcedure.query(() => {
    const totalCredits = toCredits(TOTAL_PIPELINE_COST);
    return {
      steps: [
        { step: 'imagen_2d', label: 'Google Imagen 3 (2D art)', costUsd: COSTS.imagen_2d },
        { step: 'meshy_3d', label: 'Meshy image-to-3D', costUsd: COSTS.meshy_image_to_3d },
        { step: 'meshy_texture', label: 'Meshy text-to-texture', costUsd: COSTS.meshy_texture },
      ],
      totalProviderCostUsd: TOTAL_PIPELINE_COST,
      totalFiatPriceUsd: +(TOTAL_PIPELINE_COST * FIAT_MARGIN).toFixed(2),
      totalCredits,
    };
  }),
});

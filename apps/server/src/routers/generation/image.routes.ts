/**
 * Image Generation Router
 *
 * Provides two API surfaces:
 *
 *   image.generate      — Routed, billed, tracked generation. Uses the image
 *                         model registry for smart auto-routing or manual model
 *                         selection. Deducts credits, falls back on failure,
 *                         saves provenance to Firestore, and tracks quests.
 *                         This is the recommended endpoint for all new clients.
 *
 *   image.estimateCost  — Pre-flight cost estimate (no credit deduction).
 *   image.listModels    — Model catalog for UI display.
 *   image.history       — User's generation history.
 *
 *   image.generateImage   — Raw fal call (legacy, credit-billed).
 *   image.editImage       — Raw fal edit (legacy, credit-billed).
 *   image.imageToImage    — Raw fal img2img (legacy, credit-billed).
 *   image.generateCharacter / analyzeCharacter / saveCharacter — character tools.
 */
import {
  router,
  protectedProcedure,
  publicProcedure,
  adminProcedure,
  requirePermission,
} from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { falService } from '../../services/fal';
import { bytedanceService } from '../../services/bytedance';
import { db } from '../../lib/firebase';
import { geminiService } from '../../services/gemini';
import { wrapError } from '../../lib/errors';
import { FieldValue } from 'firebase-admin/firestore';
import {
  routeImageModel,
  validateImageModelSelection,
  getImageModelById,
  getVisibleImageModels,
  markImageProviderUnhealthy,
  markImageProviderHealthy,
  IMAGE_MODELS,
} from '../../services/image-models';
import { trackQuests } from '../../services/quest-tracker';
import { createAttachment } from '../media/media.handlers';
import { logFailedRefund } from '../../lib/refund-audit';
import { getStorageManager } from '../../services/storage';
import { signWithProvenance } from '../../services/provenance';
import type { ImageGenerationRecord } from '../../services/image-models/types';

// ── Collections ───────────────────────────────────────────────────────

const imageGenerationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('imageGenerations');
};
const imageModelOverridesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('imageModelOverrides');
};
const charactersCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('characters');
};

// ── Schemas ───────────────────────────────────────────────────────────

const imageSizeSchema = z.enum([
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
]);

const generateSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  task: z.enum(['text_to_image', 'image_to_image']).default('text_to_image'),
  imageUrls: z.array(z.string().url()).optional(), // required for image_to_image
  imageSize: imageSizeSchema.default('square_hd'),
  numImages: z.number().min(1).max(4).default(1),
  negativePrompt: z.string().optional(),
  seed: z.number().optional(),

  routingMode: z.enum(['auto', 'manual']).default('auto'),
  selectedModelId: z.string().optional(),
  allowFallback: z.boolean().default(true),
  entityId: z.string().optional(),
  universeId: z.string().optional(),

  qualityTarget: z.enum(['draft', 'standard', 'premium']).optional(),
  costBudget: z.enum(['low', 'medium', 'any']).optional(),
  latencyPreference: z.enum(['fast', 'balanced', 'quality']).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────

async function saveRecord(record: ImageGenerationRecord): Promise<void> {
  // Strip undefined values — Firestore rejects them
  const clean = Object.fromEntries(
    Object.entries({ ...record, completedAt: record.completedAt || null }).filter(
      ([, v]) => v !== undefined
    )
  );
  await imageGenerationsCol().doc(record.id).set(clean);
}

async function attemptFallback(
  input: z.infer<typeof generateSchema>,
  failedModelId: string
): Promise<{ imageUrls: string[]; fallbackModelId: string } | null> {
  const candidates = getVisibleImageModels()
    .filter((m) => m.id !== failedModelId && m.isEnabled && m.tasks.includes(input.task))
    .sort((a, b) => {
      const qDiff =
        ({ draft: 1, standard: 2, premium: 3 }[b.qualityTier] || 0) -
        ({ draft: 1, standard: 2, premium: 3 }[a.qualityTier] || 0);
      return qDiff !== 0 ? qDiff : a.creditCostPerImage - b.creditCostPerImage;
    });

  for (const candidate of candidates.slice(0, 2)) {
    try {
      const result =
        candidate.provider === 'bytedance'
          ? await bytedanceService.generateImage({
              prompt: input.prompt,
              model: candidate.bytedanceModelId || 'seedream-5-0-260128',
              negativePrompt: input.negativePrompt,
              numImages: input.numImages,
              seed: input.seed,
            })
          : await falService.generateImage({
              prompt: input.prompt,
              model: candidate.falModelId as any,
              negativePrompt: input.negativePrompt,
              imageSize: input.imageSize,
              numImages: input.numImages,
              seed: input.seed,
            });
      if (result.status === 'completed' && result.images?.length) {
        markImageProviderHealthy(candidate.provider);
        return {
          imageUrls: result.images.map((img) => img.url),
          fallbackModelId: candidate.id,
        };
      }
    } catch {
      markImageProviderUnhealthy(candidate.provider);
    }
  }
  return null;
}

// ── Auto-attach helper ───────────────────────────────────────────────

async function autoAttachImages(opts: {
  creator: string;
  entityId: string | undefined;
  generationId: string;
  imageUrls: string[];
  prompt: string;
}) {
  if (!opts.entityId) return;

  let targetName = '';
  try {
    const entityDoc = await db.collection('entities').doc(opts.entityId).get();
    if (!entityDoc.exists) return;
    // Verify the caller owns this entity before attaching
    if (entityDoc.data()?.creator !== opts.creator) return;
    targetName = entityDoc.data()?.name ?? '';
  } catch {
    // Best-effort
  }

  for (let i = 0; i < opts.imageUrls.length; i++) {
    try {
      await createAttachment(opts.creator, {
        contentHash: `gen:${opts.generationId}:img${i}`,
        originalFilename: `generation-${opts.generationId}-${i}.png`,
        mimeType: 'image/png',
        size: 0,
        url: opts.imageUrls[i],
        targetType: 'entity',
        targetId: opts.entityId,
        targetName,
        category: 'image',
        label: opts.prompt.slice(0, 80),
        generationId: opts.generationId,
      });
    } catch (err) {
      console.error(`Failed to auto-attach image ${i}:`, err);
    }
  }
}

// ── Persist images to permanent storage (fire-and-forget) ───────────

async function persistImagesToStorage(opts: {
  generationId: string;
  imageUrls: string[];
  userId: string;
  modelId?: string;
  prompt?: string;
}) {
  try {
    const manager = getStorageManager();

    for (let i = 0; i < opts.imageUrls.length; i++) {
      const url = opts.imageUrls[i];
      const filename = `generation-${opts.generationId}-${i}.png`;
      console.log(`[persist] Uploading ${filename} to permanent storage...`);

      // Fetch the image, sign with C2PA provenance, then upload
      const response = await fetch(url);
      const arrayBuf = await response.arrayBuffer();
      let imageBuffer = Buffer.from(new Uint8Array(arrayBuf));

      imageBuffer = await signWithProvenance(imageBuffer, filename, {
        model: opts.modelId || 'unknown',
        prompt: opts.prompt,
        generatedAt: new Date().toISOString(),
        mimeType: 'image/png',
      });

      const manifest = await manager.upload(imageBuffer, filename, 'image/png', opts.userId);
      const permanentUrl = manifest.uploads[0]?.url;
      if (!permanentUrl) continue;

      // Update generation record with permanent URLs
      const genDoc = await imageGenerationsCol().doc(opts.generationId).get();
      if (genDoc.exists) {
        const existing = genDoc.data()?.imageUrls as string[] | undefined;
        if (existing && existing[i] === url) {
          existing[i] = permanentUrl;
          await imageGenerationsCol().doc(opts.generationId).update({
            imageUrls: existing,
            storagePersisted: true,
          });
        }
      }

      // Update media attachments that reference this generation
      const attachments = await db!
        .collection('mediaAttachments')
        .where('url', '==', url)
        .limit(5)
        .get();
      for (const doc of attachments.docs) {
        await doc.ref.update({ url: permanentUrl, contentHash: manifest.contentHash });
      }

      // Update gallery content docs that still point to the temp URL
      const contentDocs = await db!
        .collection('content')
        .where('mediaUrl', '==', url)
        .limit(5)
        .get();
      for (const doc of contentDocs.docs) {
        await doc.ref.update({ mediaUrl: permanentUrl, thumbnailUrl: permanentUrl });
      }

      console.log(`[persist] ${filename} saved permanently: ${permanentUrl}`);
    }
  } catch (err) {
    // Non-fatal — the temporary URL still works for now
    console.error(`[persist] Failed to persist images ${opts.generationId}:`, err);
  }
}

// ── Auto-publish to gallery ──────────────────────────────────────────

const contentCol = () => db.collection('content');

async function autoPublishToGallery(opts: {
  creatorUid: string;
  imageUrls: string[];
  prompt: string;
  model: string;
  universeId?: string;
  generationId: string;
}) {
  const now = new Date();
  for (const url of opts.imageUrls) {
    await contentCol().add({
      title: opts.prompt.slice(0, 100) || 'Generated Image',
      description: opts.prompt,
      mediaUrl: url,
      thumbnailUrl: url,
      mediaType: 'ai-image',
      classification: 'original',
      tags: [],
      ipDeclaration: {
        isOriginal: true,
        usesCopyrightedMaterial: false,
        license: 'all-rights-reserved',
      },
      visibility: 'public',
      creatorUid: opts.creatorUid,
      ...(opts.universeId ? { universeId: opts.universeId } : {}),
      createdAt: now,
      updatedAt: now,
      views: 0,
      likes: 0,
      reviewStatus: 'not_required',
      generationId: opts.generationId,
      generationModel: opts.model,
    });
  }
}

// ── Router ────────────────────────────────────────────────────────────

export const imageRouter = router({
  // ── Routed generation (new primary endpoint) ─────────────────────────

  generate: protectedProcedure
    .use(requirePermission('generation.image'))
    .input(generateSchema)
    .mutation(async ({ input, ctx }) => {
      const genId = randomUUID();
      const startTime = Date.now();

      // ── Validate image_to_image inputs ──────────────────────────────
      if (input.task === 'image_to_image' && (!input.imageUrls || input.imageUrls.length === 0)) {
        throw new Error('imageUrls is required for image_to_image task');
      }

      // ── Resolve model ────────────────────────────────────────────────
      let finalModelId: string;
      let reasonCode: ImageGenerationRecord['routingReasonCode'];
      let providerCostUsd: number;
      let fiatPriceUsd: number;
      let loarPriceUsd: number;
      let creditCostPerImage: number;
      let requestedModelId: string | undefined;

      if (input.routingMode === 'manual' && input.selectedModelId) {
        requestedModelId = input.selectedModelId;
        const validation = validateImageModelSelection(input.selectedModelId, { task: input.task });
        if (!validation.valid) {
          throw new Error(
            `Cannot use selected model: ${validation.reason}` +
              (validation.suggestion ? `. Try "${validation.suggestion}" instead.` : '')
          );
        }
        const model = getImageModelById(input.selectedModelId)!;
        finalModelId = model.id;
        reasonCode = 'manual_user_selection';
        providerCostUsd = model.providerCostUsd;
        fiatPriceUsd = model.fiatPriceUsd;
        loarPriceUsd = model.loarPriceUsd;
        creditCostPerImage = model.creditCostPerImage;
      } else {
        const decision = routeImageModel({
          task: input.task,
          numImages: input.numImages,
          qualityTarget: input.qualityTarget,
          costBudget: input.costBudget,
          latencyPreference: input.latencyPreference,
        });
        finalModelId = decision.chosenModelId;
        reasonCode = decision.reasonCode;
        providerCostUsd = decision.providerCostUsd;
        fiatPriceUsd = decision.fiatPriceUsd;
        loarPriceUsd = decision.loarPriceUsd;
        creditCostPerImage = decision.creditCostPerImage;
      }

      const model = getImageModelById(finalModelId);
      if (!model) throw new Error(`Model ${finalModelId} not found`);

      const totalCredits = creditCostPerImage * input.numImages;
      const totalFiat = fiatPriceUsd * input.numImages;
      const totalLoar = loarPriceUsd * input.numImages;
      const totalProvider = providerCostUsd * input.numImages;

      // ── Save initial record ──────────────────────────────────────────
      const record: ImageGenerationRecord = {
        id: genId,
        userId: ctx.user.uid,
        entityId: input.entityId,
        universeId: input.universeId,
        routingMode: input.routingMode,
        requestedModelId,
        finalModelId,
        provider: model.provider,
        status: 'queued',
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        task: input.task,
        imageSize: input.imageSize,
        numImages: input.numImages,
        seed: input.seed,
        providerCostUsd: totalProvider,
        fiatPriceUsd: totalFiat,
        loarPriceUsd: totalLoar,
        creditsCharged: totalCredits,
        marginUsd: totalFiat - totalProvider,
        routingReasonCode: reasonCode,
        createdAt: new Date(),
      };
      await saveRecord(record);

      // ── Deduct credits ───────────────────────────────────────────────
      if (!db) throw new Error('Firebase is not configured — cannot deduct credits');
      const userCreditsRef = db.collection('userCredits').doc(ctx.user.uid);
      try {
        await db.runTransaction(async (tx) => {
          const doc = await tx.get(userCreditsRef);
          const balance = doc.exists ? doc.data()?.balance || 0 : 0;
          if (balance < totalCredits) {
            throw new Error(
              `Insufficient credits. Need ${totalCredits}, have ${balance}. Purchase more credits to continue.`
            );
          }
          tx.update(userCreditsRef, {
            balance: balance - totalCredits,
            totalSpent: (doc.data()?.totalSpent || 0) + totalCredits,
            updatedAt: new Date(),
          });
        });
      } catch (err) {
        await imageGenerationsCol()
          .doc(genId)
          .update({
            status: 'failed',
            failureReason: err instanceof Error ? err.message : 'Credit deduction failed',
            completedAt: new Date(),
          });
        throw err;
      }

      // ── Generate ─────────────────────────────────────────────────────
      try {
        await imageGenerationsCol().doc(genId).update({ status: 'running' });

        // Dispatch to correct provider
        const result =
          model.provider === 'bytedance'
            ? await bytedanceService.generateImage({
                prompt: input.prompt,
                model: model.bytedanceModelId || 'seedream-5-0-260128',
                negativePrompt: input.negativePrompt,
                numImages: input.numImages,
                seed: input.seed,
              })
            : await falService.generateImage({
                prompt: input.prompt,
                model: model.falModelId as any,
                negativePrompt: input.negativePrompt,
                imageSize: input.imageSize,
                numImages: input.numImages,
                seed: input.seed,
              });

        if (result.status !== 'completed' || !result.images?.length) {
          markImageProviderUnhealthy(model.provider);

          if (input.allowFallback) {
            const fallback = await attemptFallback(input, model.id);
            if (fallback) {
              const latencyMs = Date.now() - startTime;
              await imageGenerationsCol().doc(genId).update({
                status: 'completed',
                fallbackModelId: fallback.fallbackModelId,
                imageUrls: fallback.imageUrls,
                latencyMs,
                completedAt: new Date(),
              });
              // Auto-attach fallback images to entity
              autoAttachImages({
                creator: ctx.user.uid,
                entityId: input.entityId,
                generationId: genId,
                imageUrls: fallback.imageUrls,
                prompt: input.prompt,
              }).catch((err) => console.error('[image] side-effect failed:', err.message));

              // Auto-publish fallback images to gallery
              autoPublishToGallery({
                creatorUid: ctx.user.uid,
                imageUrls: fallback.imageUrls,
                prompt: input.prompt,
                model: fallback.fallbackModelId,
                universeId: input.universeId,
                generationId: genId,
              }).catch((err) => console.error('[image] gallery publish failed:', err.message));

              return {
                generationId: genId,
                status: 'completed' as const,
                imageUrls: fallback.imageUrls,
                modelUsed: fallback.fallbackModelId,
                modelDisplayName:
                  getImageModelById(fallback.fallbackModelId)?.displayName ||
                  fallback.fallbackModelId,
                routingMode: input.routingMode,
                reasonCode,
                creditsCharged: totalCredits,
                fiatPriceUsd: totalFiat,
                wasFallback: true,
              };
            }
          }

          // All generation paths failed — refund and report failure
          const failLatencyMs = Date.now() - startTime;
          const failReason = result.error || 'Image generation failed';

          try {
            await userCreditsRef.update({
              balance: FieldValue.increment(totalCredits),
              totalSpent: FieldValue.increment(-totalCredits),
              updatedAt: new Date(),
            });
          } catch (refundErr) {
            console.error(`CRITICAL: Image credit refund failed for ${ctx.user.uid}:`, refundErr);
            logFailedRefund({
              userId: ctx.user.uid,
              credits: totalCredits,
              source: 'image.generate',
              generationId: genId,
              error: refundErr instanceof Error ? refundErr.message : 'Unknown',
            });
          }

          await imageGenerationsCol().doc(genId).update({
            status: 'failed',
            creditsRefunded: true,
            failureReason: failReason,
            latencyMs: failLatencyMs,
            completedAt: new Date(),
          });
          throw new Error(failReason);
        }

        markImageProviderHealthy(model.provider);
        const latencyMs = Date.now() - startTime;
        const imageUrls = result.images.map((img) => img.url);

        // Fire-and-forget quest tracking
        try {
          trackQuests(ctx.user.uid, [
            { questId: 'first_image_generation' },
            { questId: 'daily_generation' },
            { questId: 'generate_10_images' },
          ]);
        } catch (err: any) {
          console.error('[image] quest tracking failed:', err.message);
        }

        await imageGenerationsCol().doc(genId).update({
          status: 'completed',
          imageUrls,
          seed: result.seed,
          latencyMs,
          completedAt: new Date(),
        });

        // Auto-attach images to entity
        autoAttachImages({
          creator: ctx.user.uid,
          entityId: input.entityId,
          generationId: genId,
          imageUrls,
          prompt: input.prompt,
        }).catch((err) => console.error('[image] side-effect failed:', err.message));

        // Auto-publish each generated image to gallery
        autoPublishToGallery({
          creatorUid: ctx.user.uid,
          imageUrls,
          prompt: input.prompt,
          model: finalModelId,
          universeId: input.universeId,
          generationId: genId,
        }).catch((err) => console.error('[image] gallery publish failed:', err.message));

        // Persist to permanent storage so gallery images don't expire
        persistImagesToStorage({
          generationId: genId,
          imageUrls,
          userId: ctx.user.uid,
          modelId: finalModelId,
          prompt: input.prompt,
        }).catch((err) => console.error('[image] storage persist failed:', err.message));

        return {
          generationId: genId,
          status: 'completed' as const,
          imageUrls,
          seed: result.seed,
          modelUsed: finalModelId,
          modelDisplayName: model.displayName,
          routingMode: input.routingMode,
          reasonCode,
          creditsCharged: totalCredits,
          fiatPriceUsd: totalFiat,
          wasFallback: false,
        };
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Check durable refund flag — skip if already refunded by inline failure path
        const genDoc = await imageGenerationsCol().doc(genId).get();
        const alreadyRefunded = genDoc.exists && genDoc.data()?.creditsRefunded === true;

        if (!alreadyRefunded) {
          try {
            await userCreditsRef.update({
              balance: FieldValue.increment(totalCredits),
              totalSpent: FieldValue.increment(-totalCredits),
              updatedAt: new Date(),
            });
          } catch (refundErr) {
            console.error(`CRITICAL: Image credit refund failed for ${ctx.user.uid}:`, refundErr);
            logFailedRefund({
              userId: ctx.user.uid,
              credits: totalCredits,
              source: 'image.generate',
              generationId: genId,
              error: refundErr instanceof Error ? refundErr.message : 'Unknown',
            });
          }

          await imageGenerationsCol().doc(genId).update({
            status: 'failed',
            creditsRefunded: true,
            failureReason: errorMessage,
            latencyMs,
            completedAt: new Date(),
          });
        }
        throw error;
      }
    }),

  estimateCost: publicProcedure
    .input(
      z.object({
        task: z.enum(['text_to_image', 'image_to_image']).default('text_to_image'),
        numImages: z.number().min(1).max(4).default(1),
        routingMode: z.enum(['auto', 'manual']).default('auto'),
        selectedModelId: z.string().optional(),
        qualityTarget: z.enum(['draft', 'standard', 'premium']).optional(),
        costBudget: z.enum(['low', 'medium', 'any']).optional(),
        latencyPreference: z.enum(['fast', 'balanced', 'quality']).optional(),
      })
    )
    .query(({ input }) => {
      let model;
      let reasonCode;

      if (input.routingMode === 'manual' && input.selectedModelId) {
        model = getImageModelById(input.selectedModelId);
        reasonCode = 'manual_user_selection';
      } else {
        const decision = routeImageModel({
          task: input.task,
          numImages: input.numImages,
          qualityTarget: input.qualityTarget,
          costBudget: input.costBudget,
          latencyPreference: input.latencyPreference,
        });
        model = getImageModelById(decision.chosenModelId);
        reasonCode = decision.reasonCode;
      }

      if (!model) return { credits: 0, fiatPriceUsd: 0, loarPriceUsd: 0, modelName: 'Unknown' };

      return {
        credits: model.creditCostPerImage * input.numImages,
        fiatPriceUsd: model.fiatPriceUsd * input.numImages,
        loarPriceUsd: model.loarPriceUsd * input.numImages,
        providerCostUsd: model.providerCostUsd * input.numImages,
        modelName: model.displayName,
        modelId: model.id,
        reasonCode,
        priceTier: model.priceTier,
        qualityTier: model.qualityTier,
      };
    }),

  listModels: publicProcedure
    .input(
      z
        .object({
          task: z.enum(['text_to_image', 'image_to_image']).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      // Check admin overrides
      const overrides = new Map<string, { isEnabled: boolean; isVisibleToUsers: boolean }>();
      try {
        const snapshot = await imageModelOverridesCol().get();
        snapshot.docs.forEach((doc) => overrides.set(doc.id, doc.data() as any));
      } catch {
        // no overrides yet
      }

      let models = getVisibleImageModels()
        .map((m) => {
          const override = overrides.get(m.id);
          return override ? { ...m, ...override } : m;
        })
        .filter((m) => m.isEnabled && m.isVisibleToUsers);

      if (input?.task) {
        models = models.filter((m) => m.tasks.includes(input.task!));
      }

      return models.map((m) => ({
        id: m.id,
        provider: m.provider,
        displayName: m.displayName,
        shortDescription: m.shortDescription,
        tasks: m.tasks,
        qualityTier: m.qualityTier,
        speedTier: m.speedTier,
        priceTier: m.priceTier,
        maxImages: m.maxImages,
        supportsNegativePrompt: m.supportsNegativePrompt,
        supportsSeed: m.supportsSeed,
        creditCostPerImage: m.creditCostPerImage,
        fiatPriceUsd: m.fiatPriceUsd,
        loarPriceUsd: m.loarPriceUsd,
        tags: m.tags,
        bestFor: m.bestFor,
      }));
    }),

  history: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        entityId: z.string().optional(),
        universeId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      let query = imageGenerationsCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.entityId) {
        query = imageGenerationsCol()
          .where('userId', '==', ctx.user.uid)
          .where('entityId', '==', input.entityId)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);
      } else if (input.universeId) {
        query = imageGenerationsCol()
          .where('userId', '==', ctx.user.uid)
          .where('universeId', '==', input.universeId)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);
      }

      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  getRecord: protectedProcedure
    .input(z.object({ generationId: z.string() }))
    .query(async ({ input, ctx }) => {
      const doc = await imageGenerationsCol().doc(input.generationId).get();
      if (!doc.exists) return null;
      if (doc.data()?.userId !== ctx.user.uid) return null;
      return { id: doc.id, ...doc.data() };
    }),

  // ── Admin ─────────────────────────────────────────────────────────────

  adminListModels: adminProcedure.query(async () => {
    const overrides = new Map<string, Record<string, any>>();
    try {
      const snapshot = await imageModelOverridesCol().get();
      snapshot.docs.forEach((doc) => overrides.set(doc.id, doc.data()));
    } catch {
      // no overrides
    }
    return IMAGE_MODELS.map((m) => {
      const override = overrides.get(m.id);
      return { ...m, ...(override || {}), hasOverride: !!override };
    });
  }),

  adminUpdateModel: adminProcedure
    .input(
      z.object({
        modelId: z.string(),
        isEnabled: z.boolean().optional(),
        isVisibleToUsers: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const model = getImageModelById(input.modelId);
      if (!model) throw new Error(`Model "${input.modelId}" not found`);
      const update: Record<string, any> = { updatedAt: new Date() };
      if (input.isEnabled !== undefined) update.isEnabled = input.isEnabled;
      if (input.isVisibleToUsers !== undefined) update.isVisibleToUsers = input.isVisibleToUsers;
      await imageModelOverridesCol().doc(input.modelId).set(update, { merge: true });
      return { ok: true, modelId: input.modelId, applied: update };
    }),

  // ── Backward-compat raw endpoints (legacy endpoints — user-facing with credit billing) ───

  generateImage: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, 'Prompt is required'),
        model: z
          .enum([
            'fal-ai/nano-banana',
            'fal-ai/nano-banana-2',
            'fal-ai/nano-banana-pro',
            'fal-ai/flux/schnell',
            'fal-ai/flux/dev',
            'fal-ai/flux-pro',
            'fal-ai/flux-pro/v1.1',
            'fal-ai/flux-2-pro',
            'fal-ai/flux-pro/kontext',
            'fal-ai/recraft/v4/pro/text-to-image',
            'fal-ai/ideogram/v3/generate',
            'fal-ai/bytedance/seedream/v5/lite/edit',
            'fal-ai/gpt-image-1.5/edit',
            'fal-ai/wan/v2.7/text-to-image',
            'fal-ai/qwen-image',
          ])
          .optional(),
        negativePrompt: z.string().optional(),
        imageSize: imageSizeSchema.optional(),
        numInferenceSteps: z.number().min(1).max(50).optional(),
        guidanceScale: z.number().min(1).max(20).optional(),
        numImages: z.number().min(1).max(4).optional(),
        seed: z.number().optional(),
        enableSafetyChecker: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const cost = 3;
      if (db) {
        const userRef = db.collection('userCredits').doc(ctx.user.uid);
        const userDoc = await userRef.get();
        const balance = userDoc.data()?.balance || 0;
        if (balance < cost) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Insufficient credits. Need ${cost}, have ${balance}. Purchase more credits to continue.`,
          });
        }
        await userRef.update({ balance: balance - cost, updatedAt: new Date() });
      }
      const startTime = Date.now();
      let result;
      try {
        result = await falService.generateImage(input);
      } catch (genError) {
        // Refund credits on generation failure
        if (db) {
          const userRef = db.collection('userCredits').doc(ctx.user.uid);
          await userRef
            .update({ balance: FieldValue.increment(cost), updatedAt: new Date() })
            .catch(() => {});
        }
        throw genError;
      }
      if (result.status === 'completed' && result.imageUrl) {
        const imgGenId = result.id || randomUUID();
        try {
          await imageGenerationsCol()
            .doc(imgGenId)
            .set({
              id: imgGenId,
              userId: ctx.user?.uid || 'anonymous',
              prompt: input.prompt,
              model: input.model || 'fal-ai/nano-banana',
              imageSize: input.imageSize || 'square_hd',
              status: 'completed',
              imageUrls: result.images?.map((i) => i.url) || [result.imageUrl],
              seed: result.seed ?? null,
              source: 'image.generateImage',
              latencyMs: Date.now() - startTime,
              createdAt: new Date(),
            });
        } catch (e) {
          /* db save is best-effort */
        }
        const imageUrls = result.images?.map((i) => i.url) || [result.imageUrl];
        autoPublishToGallery({
          creatorUid: ctx.user.uid,
          imageUrls,
          prompt: input.prompt,
          model: input.model || 'fal-ai/nano-banana',
          generationId: imgGenId,
        }).catch((err) => console.error('[legacy image] gallery publish failed:', err.message));
        persistImagesToStorage({
          generationId: imgGenId,
          imageUrls,
          userId: ctx.user.uid,
          modelId: input.model || 'fal-ai/nano-banana',
          prompt: input.prompt,
        }).catch((err) => console.error('[legacy image] storage persist failed:', err.message));
      }
      return result;
    }),

  editImage: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, 'Edit prompt is required'),
        imageUrls: z.array(z.string().url()).min(1),
        numImages: z.number().min(1).max(4).optional(),
        strength: z.number().min(0.1).max(1.0).optional(),
        negativePrompt: z.string().optional(),
        numInferenceSteps: z.number().min(1).max(50).optional(),
        guidanceScale: z.number().min(1).max(20).optional(),
        seed: z.number().optional(),
        enableSafetyChecker: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const cost = 3;
      if (db) {
        const userRef = db.collection('userCredits').doc(ctx.user.uid);
        const userDoc = await userRef.get();
        const balance = userDoc.data()?.balance || 0;
        if (balance < cost) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Insufficient credits. Need ${cost}, have ${balance}. Purchase more credits to continue.`,
          });
        }
        await userRef.update({ balance: balance - cost, updatedAt: new Date() });
      }
      const startTime = Date.now();
      let result;
      try {
        result = await falService.editImage(input);
      } catch (genError) {
        // Refund credits on generation failure
        if (db) {
          const userRef2 = db.collection('userCredits').doc(ctx.user.uid);
          await userRef2
            .update({ balance: FieldValue.increment(cost), updatedAt: new Date() })
            .catch(() => {});
        }
        throw genError;
      }
      if (result.status === 'completed' && result.imageUrl) {
        const editGenId = result.id || randomUUID();
        try {
          await imageGenerationsCol()
            .doc(editGenId)
            .set({
              id: editGenId,
              userId: ctx.user?.uid || 'anonymous',
              prompt: input.prompt,
              model: 'fal-ai/nano-banana/edit',
              task: 'image_to_image',
              status: 'completed',
              imageUrls: result.images?.map((i) => i.url) || [result.imageUrl],
              seed: result.seed ?? null,
              source: 'image.editImage',
              latencyMs: Date.now() - startTime,
              createdAt: new Date(),
            });
        } catch (e) {
          /* db save is best-effort */
        }
        const imageUrls = result.images?.map((i) => i.url) || [result.imageUrl];
        autoPublishToGallery({
          creatorUid: ctx.user.uid,
          imageUrls,
          prompt: input.prompt,
          model: 'fal-ai/nano-banana/edit',
          generationId: editGenId,
        }).catch((err) => console.error('[legacy edit] gallery publish failed:', err.message));
        persistImagesToStorage({
          generationId: editGenId,
          imageUrls,
          userId: ctx.user.uid,
          modelId: 'fal-ai/nano-banana/edit',
          prompt: input.prompt,
        }).catch((err) => console.error('[legacy edit] storage persist failed:', err.message));
      }
      if (result.status === 'failed')
        throw wrapError(new Error(result.error), 'Image editing failed');
      return result;
    }),

  imageToImage: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrls: z.array(z.string().url()).min(1).max(2),
        negativePrompt: z.string().max(500).optional(),
        imageSize: z
          .union([
            imageSizeSchema,
            z.object({
              width: z.number().min(384).max(5000),
              height: z.number().min(384).max(5000),
            }),
          ])
          .optional(),
        numImages: z.number().min(1).max(4).optional().default(1),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const cost = 3;
      if (db) {
        const userRef = db.collection('userCredits').doc(ctx.user.uid);
        const userDoc = await userRef.get();
        const balance = userDoc.data()?.balance || 0;
        if (balance < cost) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Insufficient credits. Need ${cost}, have ${balance}. Purchase more credits to continue.`,
          });
        }
        await userRef.update({ balance: balance - cost, updatedAt: new Date() });
      }
      const startTime = Date.now();
      let result;
      try {
        result = await falService.imageToImage(input);
      } catch (genError) {
        // Refund credits on generation failure
        if (db) {
          const userRef2 = db.collection('userCredits').doc(ctx.user.uid);
          await userRef2
            .update({ balance: FieldValue.increment(cost), updatedAt: new Date() })
            .catch(() => {});
        }
        throw genError;
      }
      if (result.status === 'completed' && result.imageUrl) {
        const i2iGenId = result.id || randomUUID();
        try {
          await imageGenerationsCol()
            .doc(i2iGenId)
            .set({
              id: i2iGenId,
              userId: ctx.user?.uid || 'anonymous',
              prompt: input.prompt,
              model: 'fal-ai/nano-banana/edit',
              task: 'image_to_image',
              status: 'completed',
              imageUrls: result.images?.map((i) => i.url) || [result.imageUrl],
              seed: result.seed ?? null,
              source: 'image.imageToImage',
              latencyMs: Date.now() - startTime,
              createdAt: new Date(),
            });
        } catch (e) {
          /* db save is best-effort */
        }
        const imageUrls = result.images?.map((i) => i.url) || [result.imageUrl];
        autoPublishToGallery({
          creatorUid: ctx.user.uid,
          imageUrls,
          prompt: input.prompt,
          model: 'fal-ai/nano-banana/edit',
          generationId: i2iGenId,
        }).catch((err) => console.error('[legacy i2i] gallery publish failed:', err.message));
        persistImagesToStorage({
          generationId: i2iGenId,
          imageUrls,
          userId: ctx.user.uid,
          modelId: 'fal-ai/nano-banana/edit',
          prompt: input.prompt,
        }).catch((err) => console.error('[legacy i2i] storage persist failed:', err.message));
      }
      if (result.status === 'failed')
        throw wrapError(new Error(result.error), 'Image-to-image failed');
      return result;
    }),

  generateCharacter: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        style: z.enum(['cute', 'realistic', 'anime', 'fantasy', 'cyberpunk']).optional(),
        saveToDatabase: z.boolean().optional().default(true),
        detailedVisualDescription: z.string().optional(),
        universeId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const stylePrompts: Record<string, string> = {
        cute: 'cute kawaii style, adorable, soft colors',
        realistic: 'photorealistic, detailed, cinematic lighting',
        anime: 'anime style, manga aesthetic, vibrant',
        fantasy: 'fantasy art, magical, ethereal',
        cyberpunk: 'cyberpunk style, neon, futuristic',
      };
      const stylePrompt = input.style ? stylePrompts[input.style] : stylePrompts.cute;
      // Sanitize user inputs to prevent prompt injection
      const safeName = input.name.replace(/[\n\r]/g, ' ').slice(0, 100);
      const safeDesc = input.description.replace(/[\n\r]/g, ' ').slice(0, 300);
      const fullPrompt = `Character portrait of ${safeName}, ${safeDesc}, ${stylePrompt}, high quality digital art, detailed character design, clean uniform background, no text, no letters, no words, simple background, character focus`;

      const imageResult = await falService.generateImage({
        prompt: fullPrompt,
        model: 'fal-ai/nano-banana',
        imageSize: 'square_hd',
        numImages: 1,
      });

      if (imageResult.status !== 'completed' || !imageResult.imageUrl) {
        throw new Error(imageResult.error || 'Failed to generate character image');
      }

      let characterId: string | undefined;
      if (input.saveToDatabase) {
        characterId = `nano-${Date.now()}-${randomUUID().slice(0, 8)}`;
        await charactersCol()
          .doc(characterId)
          .set({
            character_name: input.name,
            collection: 'Nano Banana AI',
            token_id: characterId,
            traits: {
              style: input.style || 'cute',
              generated_with: 'nano-banana',
              seed: imageResult.seed?.toString() || 'random',
            },
            rarity_rank: 0,
            rarity_percentage: null,
            image_url: imageResult.imageUrl,
            description: input.description,
            detailed_visual_description: input.detailedVisualDescription || null,
            universe_id: input.universeId || null,
            created_at: new Date(),
            updated_at: new Date(),
          });
      }

      return {
        success: true,
        characterId,
        characterName: input.name,
        imageUrl: imageResult.imageUrl,
        seed: imageResult.seed,
        prompt: fullPrompt,
      };
    }),

  analyzeCharacter: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().min(1, 'Image URL is required'),
        characterName: z.string().min(1, 'Character name is required'),
        userDescription: z.string().min(1, 'Description is required'),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const detailedDescription = await geminiService.analyzeCharacterImage(
          input.imageUrl,
          input.userDescription,
          input.characterName
        );
        return {
          success: true,
          characterName: input.characterName,
          detailedVisualDescription: detailedDescription,
        };
      } catch (error) {
        throw wrapError(error, 'Failed to analyze character image');
      }
    }),

  saveCharacter: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Character name is required'),
        description: z.string().min(1, 'Description is required'),
        imageUrl: z.string().min(1, 'Image URL is required'),
        style: z.enum(['cute', 'realistic', 'anime', 'fantasy', 'cyberpunk']),
        detailedVisualDescription: z.string().optional(),
        universeId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const characterId = `nano-${Date.now()}-${randomUUID().slice(0, 8)}`;
      await charactersCol()
        .doc(characterId)
        .set({
          character_name: input.name,
          collection: 'Nano Banana AI',
          token_id: characterId,
          traits: { style: input.style, generated_with: 'nano-banana' },
          rarity_rank: 0,
          rarity_percentage: null,
          image_url: input.imageUrl,
          description: input.description,
          detailed_visual_description: input.detailedVisualDescription || null,
          universe_id: input.universeId || null,
          created_at: new Date(),
          updated_at: new Date(),
        });
      return { success: true, characterId, characterName: input.name, imageUrl: input.imageUrl };
    }),
});

/**
 * Unified Video Generation Router
 *
 * Supports Smart Auto routing and Manual model selection.
 * Persists generation records to Firestore for analytics.
 * Handles fallback logic and cost tracking.
 */
import {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  requirePermission,
} from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { falService } from '../../services/fal';
import { bytedanceService } from '../../services/bytedance';
import type { ByteDanceVideoOptions } from '../../services/bytedance';
import { getStorageManager } from '../../services/storage';
import {
  routeModel,
  validateManualSelection,
  getModelById,
  getVisibleModels,
  getModelsForMode,
  getEnabledModels,
  VIDEO_MODELS,
  markProviderUnhealthy,
  markProviderHealthy,
} from '../../services/video-models';
import { trackQuests, trackModelUsage } from '../../services/quest-tracker';
import { FieldValue } from 'firebase-admin/firestore';
import { createAttachment } from '../media/media.handlers';
import { logFailedRefund } from '../../lib/refund-audit';
import type {
  VideoGenerationRecord,
  RoutingMode,
  RoutingReasonCode,
  VideoGenerationMode,
} from '../../services/video-models/types';

const generationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('videoGenerations');
};
const modelOverridesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('modelOverrides');
};

// ── Zod Schemas ───────────────────────────────────────────────────────

const routingModeSchema = z.enum(['auto', 'manual']);
const generationModeSchema = z.enum(['text_to_video', 'image_to_video']);

const generateInputSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  imageUrl: z.string().url().optional(),
  mode: generationModeSchema,
  durationSec: z.number().min(1).max(20).default(5),
  resolution: z.string().default('720p'),
  aspectRatio: z.string().default('16:9'),
  audio: z.boolean().default(false),

  routingMode: routingModeSchema.default('auto'),
  selectedModelId: z.string().optional(),
  allowFallback: z.boolean().default(true),
  entityId: z.string().optional(),
  universeId: z.string().optional(),

  // Model-specific optional params
  negativePrompt: z.string().optional(),
  motionStrength: z.number().min(1).max(255).optional(),
  cfgScale: z.number().min(0.1).max(2.0).optional(),
  enablePromptExpansion: z.boolean().optional(),

  // Routing preferences (for auto mode)
  qualityTarget: z.enum(['draft', 'standard', 'premium']).optional(),
  costBudget: z.enum(['low', 'medium', 'any']).optional(),
  latencyPreference: z.enum(['fast', 'balanced', 'quality']).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────

function buildFalInput(
  model: ReturnType<typeof getModelById>,
  input: z.infer<typeof generateInputSchema>
) {
  if (!model) throw new Error('Model not found');

  // Map resolution string to the union type expected by FalVideoGenerationOptions
  const resolution = (
    ['720p', '1080p', 'auto'].includes(input.resolution) ? input.resolution : undefined
  ) as '720p' | '1080p' | 'auto' | undefined;

  return {
    prompt: input.prompt,
    model: model.falModelId as any,
    imageUrl: input.imageUrl,
    duration: input.durationSec,
    aspectRatio: input.aspectRatio,
    resolution,
    negativePrompt: input.negativePrompt,
    motionStrength: input.motionStrength,
    cfgScale: input.cfgScale,
    enablePromptExpansion: input.enablePromptExpansion,
    generateAudio: input.audio && model.supportsAudio ? true : undefined,
  };
}

/** Build input for ByteDance ModelArk direct API */
function buildByteDanceInput(
  model: ReturnType<typeof getModelById>,
  input: z.infer<typeof generateInputSchema>
): ByteDanceVideoOptions {
  if (!model) throw new Error('Model not found');

  // Determine mode based on model ID suffix and input
  let mode: ByteDanceVideoOptions['mode'] = 'text_to_video';
  if (model.id.includes('-ref')) {
    mode = 'reference_to_video';
  } else if (model.id.includes('-i2v') || input.imageUrl) {
    mode = 'image_to_video';
  }

  return {
    prompt: input.prompt,
    model: model.bytedanceModelId || 'seedance-2.0',
    mode,
    imageUrl: input.imageUrl,
    duration: input.durationSec,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution === '1080p' ? '720p' : input.resolution || '720p',
    audio: input.audio && model.supportsAudio ? true : undefined,
    negativePrompt: input.negativePrompt,
    seed: undefined, // can be added if user passes seed
  };
}

/** Dispatch video generation to the correct provider */
async function dispatchGeneration(
  model: NonNullable<ReturnType<typeof getModelById>>,
  input: z.infer<typeof generateInputSchema>
): Promise<{ id: string; status: string; videoUrl?: string; error?: string }> {
  if (model.provider === 'bytedance') {
    const bdInput = buildByteDanceInput(model, input);
    return bytedanceService.generateVideo(bdInput);
  }

  // Default: FAL
  const falInput = buildFalInput(model, input);
  return falService.generateVideo(falInput);
}

async function saveGenerationRecord(record: VideoGenerationRecord): Promise<void> {
  await generationsCol()
    .doc(record.id)
    .set({
      ...record,
      createdAt: record.createdAt,
      completedAt: record.completedAt || null,
    });
}

// ── Auto-attach helper ───────────────────────────────────────────────

async function autoAttachVideo(opts: {
  creator: string;
  entityId: string | undefined;
  generationId: string;
  videoUrl: string;
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

  try {
    await createAttachment(opts.creator, {
      contentHash: `gen:${opts.generationId}:video`,
      originalFilename: `generation-${opts.generationId}.mp4`,
      mimeType: 'video/mp4',
      size: 0,
      url: opts.videoUrl,
      targetType: 'entity',
      targetId: opts.entityId,
      targetName,
      category: 'video',
      label: opts.prompt.slice(0, 80),
      generationId: opts.generationId,
    });
  } catch (err) {
    console.error('Failed to auto-attach video:', err);
  }
}

// ── Auto-publish video to gallery ────────────────────────────────────

const contentCol = () => db.collection('content');

async function autoPublishVideoToGallery(opts: {
  creatorUid: string;
  videoUrl: string;
  prompt: string;
  model: string;
  universeId?: string;
  generationId: string;
  thumbnailUrl?: string;
}) {
  const now = new Date();
  await contentCol().add({
    title: opts.prompt.slice(0, 100) || 'Generated Video',
    description: opts.prompt,
    mediaUrl: opts.videoUrl,
    thumbnailUrl: opts.thumbnailUrl || null,
    mediaType: 'ai-video',
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

// ── Persist video to permanent storage (fire-and-forget) ────────────

async function persistVideoToStorage(opts: {
  generationId: string;
  videoUrl: string;
  userId: string;
}) {
  try {
    const manager = getStorageManager();
    const filename = `generation-${opts.generationId}.mp4`;
    console.log(`[persist] Uploading ${filename} to permanent storage...`);

    const manifest = await manager.uploadFromUrl(opts.videoUrl, filename, opts.userId);
    const permanentUrl = manifest.uploads[0]?.url;

    if (permanentUrl) {
      // Update the generation record with the permanent URL
      await generationsCol().doc(opts.generationId).update({
        permanentVideoUrl: permanentUrl,
        storageContentHash: manifest.contentHash,
        storagePersisted: true,
      });

      // Also update any media attachment that references this generation
      const attachments = await db
        .collection('mediaAttachments')
        .where('generationId', '==', opts.generationId)
        .limit(5)
        .get();

      for (const doc of attachments.docs) {
        await doc.ref.update({ url: permanentUrl, contentHash: manifest.contentHash });
      }

      // Update gallery content documents that reference this generation
      const contentDocs = await db
        .collection('content')
        .where('generationId', '==', opts.generationId)
        .limit(5)
        .get();

      for (const doc of contentDocs.docs) {
        await doc.ref.update({ mediaUrl: permanentUrl });
      }

      console.log(`[persist] ${filename} saved permanently: ${permanentUrl}`);
    }
  } catch (err) {
    // Non-fatal — the temporary URL still works for now
    console.error(`[persist] Failed to persist video ${opts.generationId}:`, err);
  }
}

// ── Legacy FAL compat helpers ────────────────────────────────────────

const LEGACY_CREDIT_COSTS = { image: 3, video: 13, character: 8, edit: 3 } as const;

/** Deduct credits from user balance. Throws if insufficient. */
async function deductCredits(uid: string, cost: number, generationType: string): Promise<void> {
  if (!db) return;
  const userRef = db.collection('userCredits').doc(uid);
  const userDoc = await userRef.get();
  const balance = userDoc.data()?.balance || 0;

  if (balance < cost) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `Insufficient credits. Need ${cost}, have ${balance}. Purchase more credits to continue.`,
    });
  }

  await userRef.update({
    balance: balance - cost,
    totalSpent: (userDoc.data()?.totalSpent || 0) + cost,
    updatedAt: new Date(),
  });

  await db.collection('creditTransactions').add({
    uid,
    type: 'spend',
    generationType,
    credits: -cost,
    source: 'generation_legacy',
    createdAt: new Date(),
  });
}

/** Refund credits on generation failure. Best-effort — never throws. */
async function refundCredits(uid: string, cost: number): Promise<void> {
  if (!db) return;
  try {
    const { FieldValue } = await import('firebase-admin/firestore');
    await db
      .collection('userCredits')
      .doc(uid)
      .update({
        balance: FieldValue.increment(cost),
        totalSpent: FieldValue.increment(-cost),
        updatedAt: new Date(),
      });
  } catch (err) {
    console.error(`[refundCredits] Failed to refund ${cost} to ${uid}:`, err);
  }
}

const videoGenerationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('videoGenerations');
};

/** Fire-and-forget save for legacy routes — never blocks the response */
function saveLegacyVideoRecord(record: Record<string, any>) {
  try {
    videoGenerationsCol()
      .doc(record.id)
      .set(record)
      .catch((err: any) =>
        console.error('Failed to save legacy video generation record:', err.message)
      );
  } catch {
    // db not configured — skip silently
  }
}

// ── Router ────────────────────────────────────────────────────────────

export const generationRouter = router({
  /**
   * List available models for the client UI.
   * Returns models filtered by generation mode with metadata for display.
   */
  listModels: publicProcedure
    .input(
      z
        .object({
          mode: generationModeSchema.optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      // Check for admin overrides in Firestore
      const overrides = new Map<string, { isEnabled: boolean; isVisibleToUsers: boolean }>();
      try {
        const snapshot = await modelOverridesCol().get();
        snapshot.docs.forEach((doc) => {
          overrides.set(doc.id, doc.data() as any);
        });
      } catch {
        // Overrides not configured yet — use defaults
      }

      let models = getVisibleModels();

      // Apply overrides
      models = models
        .map((m) => {
          const override = overrides.get(m.id);
          if (override) {
            return {
              ...m,
              isEnabled: override.isEnabled ?? m.isEnabled,
              isVisibleToUsers: override.isVisibleToUsers ?? m.isVisibleToUsers,
            };
          }
          return m;
        })
        .filter((m) => m.isEnabled && m.isVisibleToUsers);

      // Filter by mode if specified
      if (input?.mode) {
        models = models.filter((m) => m.mode.includes(input.mode!));
      }

      return models.map((m) => ({
        id: m.id,
        provider: m.provider,
        displayName: m.displayName,
        shortDescription: m.shortDescription,
        mode: m.mode,
        qualityTier: m.qualityTier,
        speedTier: m.speedTier,
        priceTier: m.priceTier,
        supportsAudio: m.supportsAudio,
        supports1080p: m.supports1080p,
        maxDurationSec: m.maxDurationSec,
        supportedDurations: m.supportedDurations,
        supportedAspectRatios: m.supportedAspectRatios,
        creditCost: m.creditCost,
        fiatPriceUsd: m.fiatPriceUsd,
        loarPriceUsd: m.loarPriceUsd,
        tags: m.tags,
        bestFor: m.bestFor,
      }));
    }),

  /**
   * Get cost estimate before generation (pre-flight).
   */
  estimateCost: publicProcedure
    .input(
      z.object({
        routingMode: routingModeSchema.default('auto'),
        selectedModelId: z.string().optional(),
        mode: generationModeSchema,
        durationSec: z.number().default(5),
        resolution: z.string().default('720p'),
        audio: z.boolean().default(false),
        qualityTarget: z.enum(['draft', 'standard', 'premium']).optional(),
        costBudget: z.enum(['low', 'medium', 'any']).optional(),
        latencyPreference: z.enum(['fast', 'balanced', 'quality']).optional(),
      })
    )
    .query(({ input }) => {
      if (input.routingMode === 'manual' && input.selectedModelId) {
        const model = getModelById(input.selectedModelId);
        if (!model)
          return {
            credits: 0,
            fiatPriceUsd: 0,
            loarPriceUsd: 0,
            modelName: 'Unknown',
            priceTier: undefined as string | undefined,
          };
        return {
          credits: model.creditCost,
          fiatPriceUsd: model.fiatPriceUsd,
          loarPriceUsd: model.loarPriceUsd,
          providerCostUsd: model.providerCostUsd,
          fiatMarginUsd: model.fiatPriceUsd - model.providerCostUsd,
          loarMarginUsd: model.loarPriceUsd - model.providerCostUsd,
          modelName: model.displayName,
          priceTier: model.priceTier,
          qualityTier: model.qualityTier,
        };
      }

      // Auto mode — run router to estimate
      const decision = routeModel({
        mode: input.mode,
        durationSec: input.durationSec,
        resolution: input.resolution,
        audio: input.audio,
        qualityTarget: input.qualityTarget,
        costBudget: input.costBudget,
        latencyPreference: input.latencyPreference,
      });

      const model = getModelById(decision.chosenModelId);
      return {
        credits: decision.creditCost,
        fiatPriceUsd: decision.fiatPriceUsd,
        loarPriceUsd: decision.loarPriceUsd,
        providerCostUsd: decision.providerCostUsd,
        fiatMarginUsd: decision.fiatPriceUsd - decision.providerCostUsd,
        loarMarginUsd: decision.loarPriceUsd - decision.providerCostUsd,
        modelName: model?.displayName || 'Smart Auto',
        modelId: decision.chosenModelId,
        reasonCode: decision.reasonCode,
        priceTier: model?.priceTier,
        qualityTier: model?.qualityTier,
      };
    }),

  /**
   * Main generation endpoint — handles both auto and manual routing.
   */
  generate: protectedProcedure
    .use(requirePermission('generation.video'))
    .input(generateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const generationId = randomUUID();
      const startTime = Date.now();

      // Preserve the user's original prompt before universe config modifies it
      const originalPrompt = input.prompt;

      // ── Universe Gen Config enforcement ─────────────────────────────
      let genConfig: any = null;
      if (input.universeId && db) {
        const genConfigDoc = await db
          .collection('universeGenConfigs')
          .doc(input.universeId.toLowerCase())
          .get();
        if (genConfigDoc.exists) {
          genConfig = genConfigDoc.data();

          // Access control
          if (genConfig.accessType === 'WHITELISTED') {
            const address = ctx.user.address?.toLowerCase();
            const whitelisted = (genConfig.whitelistedAddresses || []).map((a: string) =>
              a.toLowerCase()
            );
            if (!address || !whitelisted.includes(address)) {
              // Check if universe admin
              const universeDoc = await db
                .collection('cinematicUniverses')
                .doc(input.universeId.toLowerCase())
                .get();
              const isAdmin =
                universeDoc.exists &&
                universeDoc.data()?.creator?.toLowerCase() === ctx.user.uid.toLowerCase();
              if (!isAdmin) {
                throw new Error('Not whitelisted for generation in this universe');
              }
            }
          }
          // HOLDERS access type — client-side check (on-chain token balance)

          // Model validation
          if (input.routingMode === 'manual' && input.selectedModelId) {
            const approved: string[] = genConfig.approvedModelIds || [];
            const blocked: string[] = genConfig.blockedModelIds || [];
            if (approved.length > 0 && !approved.includes(input.selectedModelId)) {
              throw new Error('Selected model is not approved for this universe');
            }
            if (blocked.includes(input.selectedModelId)) {
              throw new Error('Selected model is blocked in this universe');
            }
          }

          // Prompt modification — sanitize config values to prevent prompt injection
          const sanitize = (s: string) => s.replace(/[\n\r]/g, ' ').slice(0, 500);
          if (genConfig.defaultPromptPrefix) {
            input.prompt = `${sanitize(genConfig.defaultPromptPrefix)} ${input.prompt}`;
          }
          if (genConfig.defaultPromptSuffix) {
            input.prompt = `${input.prompt} ${sanitize(genConfig.defaultPromptSuffix)}`;
          }

          // Inject negative prompts
          if (genConfig.negativePrompts?.length > 0) {
            const existingNeg = input.negativePrompt || '';
            const configNeg = genConfig.negativePrompts.map((s: string) => sanitize(s)).join(', ');
            input.negativePrompt = existingNeg ? `${existingNeg}, ${configNeg}` : configNeg;
          }
        }
      }

      let finalModelId: string;
      let reasonCode: RoutingReasonCode;
      let providerCostUsd: number;
      let fiatPriceUsd: number;
      let loarPriceUsd: number;
      let creditsCharged: number;
      let requestedModelId: string | undefined;

      // ── Resolve model ───────────────────────────────────────────────
      if (input.routingMode === 'manual' && input.selectedModelId) {
        requestedModelId = input.selectedModelId;

        const validation = validateManualSelection(input.selectedModelId, {
          mode: input.mode,
          durationSec: input.durationSec,
          resolution: input.resolution,
          audio: input.audio,
        });

        if (!validation.valid) {
          throw new Error(
            `Cannot use selected model: ${validation.reason}` +
              (validation.suggestion ? `. Try "${validation.suggestion}" instead.` : '')
          );
        }

        const model = getModelById(input.selectedModelId)!;
        finalModelId = model.id;
        reasonCode = 'manual_user_selection';
        providerCostUsd = model.providerCostUsd;
        fiatPriceUsd = model.fiatPriceUsd;
        loarPriceUsd = model.loarPriceUsd;
        creditsCharged = model.creditCost;
      } else {
        // Auto routing
        const decision = routeModel({
          mode: input.mode,
          durationSec: input.durationSec,
          resolution: input.resolution,
          audio: input.audio,
          universeId: input.universeId,
          qualityTarget: input.qualityTarget,
          costBudget: input.costBudget,
          latencyPreference: input.latencyPreference,
        });

        finalModelId = decision.chosenModelId;
        reasonCode = decision.reasonCode;
        providerCostUsd = decision.providerCostUsd;
        fiatPriceUsd = decision.fiatPriceUsd;
        loarPriceUsd = decision.loarPriceUsd;
        creditsCharged = decision.creditCost;
      }

      const model = getModelById(finalModelId);
      if (!model) throw new Error(`Model ${finalModelId} not found in registry`);

      // ── Apply universe credit multiplier ───────────────────────────
      if (genConfig?.creditMultiplier && genConfig.creditMultiplier !== 1.0) {
        creditsCharged = Math.ceil(creditsCharged * genConfig.creditMultiplier);
      }
      if (genConfig?.minCreditsPerGen && creditsCharged < genConfig.minCreditsPerGen) {
        creditsCharged = genConfig.minCreditsPerGen;
      }

      // ── Build initial record ────────────────────────────────────────
      const record: VideoGenerationRecord & { entityId?: string; originalPrompt?: string } = {
        id: generationId,
        userId: ctx.user.uid,
        ...(input.entityId ? { entityId: input.entityId } : {}),
        ...(input.universeId ? { universeId: input.universeId } : {}),
        routingMode: input.routingMode,
        ...(requestedModelId ? { requestedModelId } : {}),
        finalModelId,
        provider: model.provider,
        status: 'queued',
        prompt: input.prompt,
        ...(originalPrompt !== input.prompt ? { originalPrompt } : {}),
        mode: input.mode,
        durationSec: input.durationSec,
        resolution: input.resolution,
        aspectRatio: input.aspectRatio,
        providerCostUsd,
        fiatPriceUsd,
        loarPriceUsd,
        creditsCharged,
        marginUsd: fiatPriceUsd - providerCostUsd,
        routingReasonCode: reasonCode,
        createdAt: new Date(),
      };

      // Save initial record
      await saveGenerationRecord(record);

      // ── Deduct credits (transactional) ─────────────────────────────
      const userCreditsRef = db.collection('userCredits').doc(ctx.user.uid);
      if (creditsCharged > 0) {
        try {
          await db.runTransaction(async (tx) => {
            const userCreditsDoc = await tx.get(userCreditsRef);
            const currentBalance = userCreditsDoc.exists ? userCreditsDoc.data()?.balance || 0 : 0;

            if (currentBalance < creditsCharged) {
              throw new Error(
                `Insufficient credits. Need ${creditsCharged}, have ${currentBalance}. Purchase more credits to continue.`
              );
            }

            tx.update(userCreditsRef, {
              balance: currentBalance - creditsCharged,
              totalSpent: (userCreditsDoc.data()?.totalSpent || 0) + creditsCharged,
              updatedAt: new Date(),
            });
          });
        } catch (creditErr) {
          await generationsCol()
            .doc(generationId)
            .update({
              status: 'failed',
              failureReason:
                creditErr instanceof Error ? creditErr.message : 'Credit deduction failed',
              completedAt: new Date(),
            });
          throw creditErr;
        }
      }

      // ── Generate ────────────────────────────────────────────────────
      try {
        record.status = 'running';
        await generationsCol().doc(generationId).update({ status: 'running' });

        const result = await dispatchGeneration(model, input);

        const latencyMs = Date.now() - startTime;

        if (result.status === 'failed' || result.error || !result.videoUrl) {
          // Mark provider unhealthy on failure
          markProviderUnhealthy(model.provider);

          // Attempt fallback in auto mode
          if (input.routingMode === 'auto' && input.allowFallback) {
            const fallbackResult = await attemptFallback(input, model.id, generationId);
            if (fallbackResult) {
              // Update record with fallback info
              await generationsCol()
                .doc(generationId)
                .update({
                  status: 'completed',
                  fallbackModelId: fallbackResult.fallbackModelId,
                  videoUrl: fallbackResult.videoUrl,
                  latencyMs: Date.now() - startTime,
                  completedAt: new Date(),
                });

              // Auto-attach fallback video to entity
              autoAttachVideo({
                creator: ctx.user.uid,
                entityId: input.entityId,
                generationId,
                videoUrl: fallbackResult.videoUrl,
                prompt: originalPrompt,
              });

              // Fire-and-forget: persist to permanent storage
              persistVideoToStorage({
                generationId,
                videoUrl: fallbackResult.videoUrl,
                userId: ctx.user.uid,
              }).catch(() => {});

              // Auto-publish fallback video to gallery
              autoPublishVideoToGallery({
                creatorUid: ctx.user.uid,
                videoUrl: fallbackResult.videoUrl,
                prompt: originalPrompt,
                model: fallbackResult.fallbackModelId,
                universeId: input.universeId,
                thumbnailUrl: input.imageUrl,
                generationId,
              }).catch((err: Error) =>
                console.error('[video] gallery publish failed:', err.message)
              );

              return {
                generationId,
                status: 'completed' as const,
                videoUrl: fallbackResult.videoUrl,
                modelUsed: fallbackResult.fallbackModelId,
                modelDisplayName:
                  getModelById(fallbackResult.fallbackModelId)?.displayName ||
                  fallbackResult.fallbackModelId,
                routingMode: input.routingMode,
                reasonCode,
                creditsCharged,
                fiatPriceUsd,
                wasFallback: true,
                originalPrompt: originalPrompt !== input.prompt ? originalPrompt : undefined,
              };
            }
          }

          // No fallback or manual mode — fail
          await generationsCol().doc(generationId).update({
            status: 'failed',
            failureReason: result.error,
            latencyMs,
            completedAt: new Date(),
          });

          throw new Error(result.error || 'Video generation failed');
        }

        // Success — mark provider healthy + track quests
        markProviderHealthy(model.provider);

        // Fire-and-forget quest tracking
        trackQuests(ctx.user.uid, [
          { questId: 'first_generation' },
          { questId: 'daily_generation' },
          { questId: 'generate_5_videos' },
          { questId: 'generate_100_videos' },
          ...(input.routingMode === 'auto' ? [{ questId: 'smart_auto_10' }] : []),
        ]);
        trackModelUsage(ctx.user.uid, finalModelId);

        await generationsCol().doc(generationId).update({
          status: 'completed',
          videoUrl: result.videoUrl,
          latencyMs,
          completedAt: new Date(),
        });

        // Auto-attach video to entity
        autoAttachVideo({
          creator: ctx.user.uid,
          entityId: input.entityId,
          generationId,
          videoUrl: result.videoUrl!,
          prompt: originalPrompt,
        });

        // Fire-and-forget: persist to permanent storage (Pinata/IPFS)
        persistVideoToStorage({
          generationId,
          videoUrl: result.videoUrl!,
          userId: ctx.user.uid,
        }).catch(() => {}); // swallow — non-blocking

        // Auto-publish video to gallery
        autoPublishVideoToGallery({
          creatorUid: ctx.user.uid,
          videoUrl: result.videoUrl!,
          prompt: originalPrompt,
          model: finalModelId,
          universeId: input.universeId,
          generationId,
          thumbnailUrl: input.imageUrl,
        }).catch((err) => console.error('[video] gallery publish failed:', err.message));

        return {
          generationId,
          status: 'completed' as const,
          videoUrl: result.videoUrl,
          modelUsed: finalModelId,
          modelDisplayName: model.displayName,
          routingMode: input.routingMode,
          reasonCode,
          creditsCharged,
          fiatPriceUsd,
          wasFallback: false,
          originalPrompt: originalPrompt !== input.prompt ? originalPrompt : undefined,
        };
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Refund credits atomically on failure
        if (creditsCharged > 0) {
          try {
            await userCreditsRef.update({
              balance: FieldValue.increment(creditsCharged),
              totalSpent: FieldValue.increment(-creditsCharged),
              updatedAt: new Date(),
            });
            console.log(`Refunded ${creditsCharged} credits to ${ctx.user.uid}`);
          } catch (refundErr) {
            console.error(
              `CRITICAL: Credit refund failed for user ${ctx.user.uid}, ${creditsCharged} credits:`,
              refundErr
            );
            logFailedRefund({
              userId: ctx.user.uid,
              credits: creditsCharged,
              source: 'generation.generate',
              generationId,
              error: refundErr instanceof Error ? refundErr.message : 'Unknown',
            });
          }
        }

        await generationsCol().doc(generationId).update({
          status: 'failed',
          failureReason: errorMessage,
          latencyMs,
          completedAt: new Date(),
        });

        throw error;
      }
    }),

  /**
   * Get generation status/record by ID.
   */
  getRecord: protectedProcedure
    .input(z.object({ generationId: z.string() }))
    .query(async ({ input, ctx }) => {
      const doc = await generationsCol().doc(input.generationId).get();
      if (!doc.exists) return null;
      if (doc.data()?.userId !== ctx.user.uid) return null;
      return { id: doc.id, ...doc.data() };
    }),

  /**
   * List user's generation history.
   */
  history: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        entityId: z.string().optional(),
        universeId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      let query = generationsCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.entityId) {
        query = generationsCol()
          .where('userId', '==', ctx.user.uid)
          .where('entityId', '==', input.entityId)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);
      } else if (input.universeId) {
        query = generationsCol()
          .where('userId', '==', ctx.user.uid)
          .where('universeId', '==', input.universeId)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);
      }

      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  // ── Admin Endpoints ───────────────────────────────────────────────

  /**
   * Admin: List all models with full config (including hidden ones).
   */
  adminListModels: adminProcedure.query(async () => {
    const overrides = new Map<string, Record<string, any>>();
    try {
      const snapshot = await modelOverridesCol().get();
      snapshot.docs.forEach((doc) => {
        overrides.set(doc.id, doc.data());
      });
    } catch {
      // no overrides yet
    }

    return VIDEO_MODELS.map((m) => {
      const override = overrides.get(m.id);
      return {
        ...m,
        isEnabled: override?.isEnabled ?? m.isEnabled,
        isVisibleToUsers: override?.isVisibleToUsers ?? m.isVisibleToUsers,
        hasOverride: !!override,
      };
    });
  }),

  /**
   * Admin: Update model settings (enable/disable, visibility, etc).
   */
  adminUpdateModel: adminProcedure
    .input(
      z.object({
        modelId: z.string(),
        isEnabled: z.boolean().optional(),
        isVisibleToUsers: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const model = getModelById(input.modelId);
      if (!model) throw new Error(`Model "${input.modelId}" not found`);

      const update: Record<string, any> = { updatedAt: new Date() };
      if (input.isEnabled !== undefined) update.isEnabled = input.isEnabled;
      if (input.isVisibleToUsers !== undefined) update.isVisibleToUsers = input.isVisibleToUsers;

      await modelOverridesCol().doc(input.modelId).set(update, { merge: true });

      return { ok: true, modelId: input.modelId, applied: update };
    }),

  /**
   * Admin: Get analytics summary for generations.
   */
  adminAnalytics: adminProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
      })
    )
    .query(async ({ input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const snapshot = await generationsCol()
        .where('createdAt', '>=', since)
        .orderBy('createdAt', 'desc')
        .limit(1000)
        .get();

      const records = snapshot.docs.map((doc) => doc.data());

      // Aggregate by model
      const byModel = new Map<
        string,
        {
          count: number;
          completed: number;
          failed: number;
          totalProviderCostUsd: number;
          totalUserPriceUsd: number;
          totalMarginUsd: number;
          totalCreditsCharged: number;
          totalLatencyMs: number;
        }
      >();

      let autoCount = 0;
      let manualCount = 0;

      for (const r of records) {
        const modelId = r.finalModelId || 'unknown';
        const existing = byModel.get(modelId) || {
          count: 0,
          completed: 0,
          failed: 0,
          totalProviderCostUsd: 0,
          totalUserPriceUsd: 0,
          totalMarginUsd: 0,
          totalCreditsCharged: 0,
          totalLatencyMs: 0,
        };

        existing.count++;
        if (r.status === 'completed') existing.completed++;
        if (r.status === 'failed') existing.failed++;
        existing.totalProviderCostUsd += r.providerCostUsd || 0;
        existing.totalUserPriceUsd += r.fiatPriceUsd || 0;
        existing.totalMarginUsd += r.marginUsd || 0;
        existing.totalCreditsCharged += r.creditsCharged || 0;
        existing.totalLatencyMs += r.latencyMs || 0;

        byModel.set(modelId, existing);

        if (r.routingMode === 'auto') autoCount++;
        else manualCount++;
      }

      const modelStats = Array.from(byModel.entries()).map(([modelId, stats]) => ({
        modelId,
        modelName: getModelById(modelId)?.displayName || modelId,
        ...stats,
        avgLatencyMs: stats.count > 0 ? Math.round(stats.totalLatencyMs / stats.count) : 0,
        failureRate: stats.count > 0 ? Math.round((stats.failed / stats.count) * 100) : 0,
      }));

      // Compute totals
      const totalProviderCost = modelStats.reduce((s, m) => s + m.totalProviderCostUsd, 0);
      const totalUserRevenue = modelStats.reduce((s, m) => s + m.totalUserPriceUsd, 0);
      const totalMargin = modelStats.reduce((s, m) => s + m.totalMarginUsd, 0);
      const totalCreditsCharged = modelStats.reduce((s, m) => s + m.totalCreditsCharged, 0);

      return {
        period: `${input.days} days`,
        totalGenerations: records.length,
        autoRouted: autoCount,
        manualSelected: manualCount,
        autoPercentage: records.length > 0 ? Math.round((autoCount / records.length) * 100) : 0,
        financials: {
          totalProviderCostUsd: Math.round(totalProviderCost * 100) / 100,
          totalUserRevenueUsd: Math.round(totalUserRevenue * 100) / 100,
          totalMarginUsd: Math.round(totalMargin * 100) / 100,
          marginPercentage:
            totalUserRevenue > 0 ? Math.round((totalMargin / totalUserRevenue) * 100) : 0,
          totalCreditsCharged: totalCreditsCharged,
        },
        modelStats: modelStats.sort((a, b) => b.count - a.count),
      };
    }),

  // ── Legacy FAL-compatible endpoints ─────────────────────────────────
  // These mirror fal.* procedures so the frontend can call generation.*
  // with the same signatures.

  generateVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        model: z
          .enum([
            // Text-to-Video
            'fal-ai/hunyuan-video',
            'fal-ai/ltx-video',
            'fal-ai/cogvideox-5b',
            'fal-ai/runway-gen3',
            'fal-ai/veo3.1/fast',
            'fal-ai/veo3.1',
            'fal-ai/veo3.1/lite',
            'fal-ai/sora-2/text-to-video',
            'fal-ai/sora-2/text-to-video/pro',
            'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
            'fal-ai/wan-25-preview/text-to-video',
            'fal-ai/wan/v2.7/text-to-video',
            'fal-ai/pixverse/v6/text-to-video',
            // Image-to-Video
            'fal-ai/veo3.1/fast/image-to-video',
            'fal-ai/veo3.1/image-to-video',
            'fal-ai/veo3.1/lite/image-to-video',
            'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
            'fal-ai/kling-video/v3/pro/image-to-video',
            'fal-ai/wan-25-preview/image-to-video',
            'fal-ai/wan/v2.7/image-to-video',
            'fal-ai/sora-2/image-to-video',
            'fal-ai/sora-2/image-to-video/pro',
            'fal-ai/pixverse/v6/image-to-video',
            // Seedance 2.0
            'bytedance/seedance-2.0/text-to-video',
            'bytedance/seedance-2.0/image-to-video',
            'bytedance/seedance-2.0/fast/text-to-video',
            'bytedance/seedance-2.0/fast/image-to-video',
            'bytedance/seedance-2.0/reference-to-video',
            'bytedance/seedance-2.0/fast/reference-to-video',
          ])
          .optional(),
        imageUrl: z.string().url().optional(),
        duration: z.number().min(1).max(20).optional(),
        fps: z.number().min(8).max(30).optional(),
        width: z.number().min(256).max(1920).optional(),
        height: z.number().min(256).max(1080).optional(),
        guidanceScale: z.number().min(1).max(20).optional(),
        numInferenceSteps: z.number().min(10).max(50).optional(),
        aspectRatio: z.enum(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'auto']).optional(),
        motionStrength: z.number().min(1).max(255).optional(),
        negativePrompt: z.string().optional(),
        cfgScale: z.number().min(0.1).max(2.0).optional(),
        resolution: z.enum(['480p', '720p', '1080p', 'auto']).optional(),
        enablePromptExpansion: z.boolean().optional(),
        generateAudio: z.boolean().optional(),
        endImageUrl: z.string().url().optional(),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, LEGACY_CREDIT_COSTS.video, 'video');
      const startTime = Date.now();
      let result;
      try {
        // Dispatch Seedance models to ByteDance direct API, everything else to FAL
        const isByteDance = input.model?.startsWith('bytedance/');
        result = isByteDance
          ? await bytedanceService.generateVideo({
              prompt: input.prompt,
              model: input.model?.includes('fast')
                ? 'dreamina-seedance-2-0-fast-260128'
                : 'dreamina-seedance-2-0-260128',
              mode: input.model?.includes('reference')
                ? 'reference_to_video'
                : input.imageUrl
                  ? 'image_to_video'
                  : 'text_to_video',
              imageUrl: input.imageUrl,
              endImageUrl: input.endImageUrl,
              duration: input.duration,
              aspectRatio: input.aspectRatio,
              resolution: input.resolution,
              audio: input.generateAudio,
              negativePrompt: input.negativePrompt,
              seed: input.seed,
            })
          : await falService.generateVideo(input);
      } catch (genError) {
        await refundCredits(ctx.user.uid, LEGACY_CREDIT_COSTS.video);
        throw genError;
      }
      if (result.status === 'failed' || result.error) {
        throw new Error(result.error || 'Video generation failed');
      }
      const legacyGenId = result.id || randomUUID();
      saveLegacyVideoRecord({
        id: legacyGenId,
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: input.model || 'fal-ai/ltx-video',
        mode: input.imageUrl ? 'image_to_video' : 'text_to_video',
        status: 'completed',
        videoUrl: result.videoUrl,
        duration: input.duration ?? null,
        aspectRatio: input.aspectRatio ?? null,
        resolution: input.resolution ?? null,
        source: 'generation.generateVideo',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      if (result.videoUrl) {
        autoPublishVideoToGallery({
          creatorUid: ctx.user.uid,
          videoUrl: result.videoUrl,
          prompt: input.prompt,
          model: input.model || 'fal-ai/ltx-video',
          generationId: legacyGenId,
          thumbnailUrl: input.imageUrl,
        }).catch((err: Error) =>
          console.error('[legacy video] gallery publish failed:', err.message)
        );
      }
      return result;
    }),

  veo3ImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        imageUrl: z.string().url(),
        duration: z
          .union([z.literal(5), z.literal(10)])
          .optional()
          .default(5),
        aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional().default('16:9'),
        motionStrength: z.number().min(1).max(255).optional().default(127),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, LEGACY_CREDIT_COSTS.video, 'video_veo3');
      const startTime = Date.now();
      let result;
      try {
        result = await falService.generateVideo({
          prompt: input.prompt,
          imageUrl: input.imageUrl,
          model: 'fal-ai/veo3.1/fast/image-to-video',
          duration: input.duration,
          aspectRatio: input.aspectRatio,
          motionStrength: input.motionStrength,
        });
      } catch (genError) {
        await refundCredits(ctx.user.uid, LEGACY_CREDIT_COSTS.video);
        throw genError;
      }
      if (result.status === 'failed' || result.error) {
        throw new Error(result.error || 'Veo3 video generation failed');
      }
      const veo3GenId = result.id || randomUUID();
      saveLegacyVideoRecord({
        id: veo3GenId,
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: 'fal-ai/veo3.1/fast/image-to-video',
        mode: 'image_to_video',
        status: 'completed',
        videoUrl: result.videoUrl,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        source: 'generation.veo3ImageToVideo',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      if (result.videoUrl) {
        autoPublishVideoToGallery({
          creatorUid: ctx.user.uid,
          videoUrl: result.videoUrl,
          prompt: input.prompt,
          model: 'fal-ai/veo3.1/fast/image-to-video',
          generationId: veo3GenId,
          thumbnailUrl: input.imageUrl,
        }).catch((err: Error) =>
          console.error('[legacy veo3] gallery publish failed:', err.message)
        );
      }
      return result;
    }),

  klingVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        imageUrl: z.string().url(),
        duration: z
          .union([z.literal(5), z.literal(10)])
          .optional()
          .default(5),
        aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional().default('16:9'),
        negativePrompt: z.string().optional(),
        cfgScale: z.number().min(0.1).max(2.0).optional().default(0.5),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, LEGACY_CREDIT_COSTS.video, 'video_kling');
      const startTime = Date.now();
      let result;
      try {
        result = await falService.generateVideo({
          prompt: input.prompt,
          imageUrl: input.imageUrl,
          model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
          duration: input.duration,
          aspectRatio: input.aspectRatio,
          negativePrompt: input.negativePrompt,
          cfgScale: input.cfgScale,
        });
      } catch (genError) {
        await refundCredits(ctx.user.uid, LEGACY_CREDIT_COSTS.video);
        throw genError;
      }
      if (result.status === 'failed' || result.error) {
        throw new Error(result.error || 'Kling video generation failed');
      }
      const klingGenId = result.id || randomUUID();
      saveLegacyVideoRecord({
        id: klingGenId,
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
        mode: 'image_to_video',
        status: 'completed',
        videoUrl: result.videoUrl,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        source: 'generation.klingVideo',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      if (result.videoUrl) {
        autoPublishVideoToGallery({
          creatorUid: ctx.user.uid,
          videoUrl: result.videoUrl,
          prompt: input.prompt,
          model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
          generationId: klingGenId,
          thumbnailUrl: input.imageUrl,
        }).catch((err: Error) =>
          console.error('[legacy kling] gallery publish failed:', err.message)
        );
      }
      return result;
    }),

  wan25ImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        imageUrl: z.string().url(),
        duration: z
          .union([z.literal(5), z.literal(10)])
          .optional()
          .default(5),
        resolution: z.enum(['720p', '1080p', 'auto']).optional().default('1080p'),
        negativePrompt: z.string().optional(),
        enablePromptExpansion: z.boolean().optional().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, LEGACY_CREDIT_COSTS.video, 'video_wan25');
      const startTime = Date.now();
      let result;
      try {
        result = await falService.generateVideo({
          prompt: input.prompt,
          imageUrl: input.imageUrl,
          model: 'fal-ai/wan-25-preview/image-to-video',
          duration: input.duration,
          resolution: input.resolution,
          negativePrompt: input.negativePrompt,
          enablePromptExpansion: input.enablePromptExpansion,
        });
      } catch (genError) {
        await refundCredits(ctx.user.uid, LEGACY_CREDIT_COSTS.video);
        throw genError;
      }
      if (result.status === 'failed' || result.error) {
        throw new Error(result.error || 'Wan25 video generation failed');
      }
      const wan25GenId = result.id || randomUUID();
      saveLegacyVideoRecord({
        id: wan25GenId,
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: 'fal-ai/wan-25-preview/image-to-video',
        mode: 'image_to_video',
        status: 'completed',
        videoUrl: result.videoUrl,
        duration: input.duration,
        resolution: input.resolution,
        source: 'generation.wan25ImageToVideo',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      if (result.videoUrl) {
        autoPublishVideoToGallery({
          creatorUid: ctx.user.uid,
          videoUrl: result.videoUrl,
          prompt: input.prompt,
          model: 'fal-ai/wan-25-preview/image-to-video',
          generationId: wan25GenId,
          thumbnailUrl: input.imageUrl,
        }).catch((err: Error) =>
          console.error('[legacy wan25] gallery publish failed:', err.message)
        );
      }
      return result;
    }),

  soraImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, 'Prompt is required for Sora video generation'),
        imageUrl: z.string().url('Valid image URL is required for Sora image-to-video'),
        duration: z
          .union([z.literal(4), z.literal(8), z.literal(12)])
          .optional()
          .default(4),
        aspectRatio: z.enum(['16:9', '9:16', '1:1', 'auto']).optional().default('auto'),
        resolution: z.enum(['720p', '1080p', 'auto']).optional().default('auto'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await deductCredits(ctx.user.uid, LEGACY_CREDIT_COSTS.video, 'video_sora');
      const startTime = Date.now();
      let result;
      try {
        result = await falService.generateVideo({
          prompt: input.prompt,
          imageUrl: input.imageUrl,
          model: 'fal-ai/sora-2/image-to-video',
          duration: input.duration,
          aspectRatio: input.aspectRatio,
          resolution: input.resolution,
        });
      } catch (genError) {
        await refundCredits(ctx.user.uid, LEGACY_CREDIT_COSTS.video);
        throw genError;
      }
      if (result.status === 'failed' || result.error) {
        throw new Error(result.error || 'Sora video generation failed');
      }
      const soraGenId = result.id || randomUUID();
      saveLegacyVideoRecord({
        id: soraGenId,
        userId: ctx.user?.uid || 'anonymous',
        prompt: input.prompt,
        model: 'fal-ai/sora-2/image-to-video',
        mode: 'image_to_video',
        status: 'completed',
        videoUrl: result.videoUrl,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        source: 'generation.soraImageToVideo',
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
      });
      if (result.videoUrl) {
        autoPublishVideoToGallery({
          creatorUid: ctx.user.uid,
          videoUrl: result.videoUrl,
          prompt: input.prompt,
          model: 'fal-ai/sora-2/image-to-video',
          generationId: soraGenId,
          thumbnailUrl: input.imageUrl,
        }).catch((err: Error) =>
          console.error('[legacy sora] gallery publish failed:', err.message)
        );
      }
      return result;
    }),

  getStatus: publicProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    return await falService.getGenerationStatus(input.id);
  }),
});

// ── Fallback Helper ───────────────────────────────────────────────────

async function attemptFallback(
  input: z.infer<typeof generateInputSchema>,
  failedModelId: string,
  generationId: string
): Promise<{ videoUrl: string; fallbackModelId: string } | null> {
  // Get fallback candidates
  const candidates = getModelsForMode(input.mode).filter(
    (m) => m.id !== failedModelId && m.isEnabled
  );

  // Sort by quality score descending, then cost ascending
  candidates.sort((a, b) => {
    const qualityDiff =
      ({ draft: 1, standard: 2, premium: 3 }[b.qualityTier] || 0) -
      ({ draft: 1, standard: 2, premium: 3 }[a.qualityTier] || 0);
    if (qualityDiff !== 0) return qualityDiff;
    return a.creditCost - b.creditCost;
  });

  // Try up to 2 fallbacks
  for (const candidate of candidates.slice(0, 2)) {
    try {
      console.log(`Attempting fallback: ${failedModelId} -> ${candidate.id}`);

      const result = await dispatchGeneration(candidate, input);

      if (result.status === 'completed' && result.videoUrl) {
        markProviderHealthy(candidate.provider);
        return { videoUrl: result.videoUrl, fallbackModelId: candidate.id };
      }
    } catch (err) {
      console.error(`Fallback ${candidate.id} also failed:`, err);
      markProviderUnhealthy(candidate.provider);
    }
  }

  return null;
}

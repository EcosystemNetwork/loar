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
  expensiveProcedure,
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
import type { ImageGenerationRecord, ImageModelConfig } from '../../services/image-models/types';
import { sanitizePrompt } from '../../lib/prompt-sanitize';
import { buildGenerationContext } from '../../services/wiki-context';
import { publishToGallery } from '../../lib/gallery-publish';

/**
 * Atomically deduct `cost` credits from `userCredits/{uid}.balance`.
 * Without a transaction, two concurrent mutations both read balance=B,
 * both pass the check, and both write B-cost — leaving the user with
 * cost × (N-1) free credits for N concurrent calls.
 */
async function deductLegacyCredits(uid: string, cost: number): Promise<void> {
  if (!db) return;
  const userRef = db.collection('userCredits').doc(uid);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const balance: number = doc.data()?.balance || 0;
    if (balance < cost) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Insufficient credits. Need ${cost}, have ${balance}. Purchase more credits to continue.`,
      });
    }
    tx.update(userRef, { balance: balance - cost, updatedAt: new Date() });
  });
}
import { googleImagenService } from '../../services/google-imagen';
import { recordAssetEventAsync } from '../../services/lineage';
import { reserveClientToken } from '../../lib/jobIdempotency';
import { fireJobWebhook, validateWebhookUrl, webhookUrlSchema } from '../../lib/webhooks';
import type { PromptRef } from '../../services/lineage/types';
import {
  CONTROL_TYPES,
  buildControlPreamble,
  applyAnglePreset,
  type ControlInput,
} from '../../services/scene-controls/controlled-gen';
import { composeStyle, applyStyleToPrompt } from '../../services/style-pack';

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
  useWikiContext: z.boolean().default(true),

  // Reference bundle (Feature 6 — Character Identity Lock + Multi-Reference Editing)
  /** Pull reference slots + locks from this entity (and its parent chain). */
  referenceBundleEntityId: z.string().optional(),
  /** Respect the entity's reference bundle. Defaults to true when the ID is set. */
  useReferenceBundle: z.boolean().default(true),

  // Style packs + moodboards (PRD 5 — Retexture, Restyle, Moodboards, House Style Packs)
  /** Entity ID of a style_pack to merge into the prompt. */
  stylePackEntityId: z.string().optional(),
  /** Entity ID of a moodboard to merge into the prompt. */
  moodboardEntityId: z.string().optional(),
  /** 0..1 — how much the style pack should dominate the result. Default 0.7. */
  styleStrength: z.number().min(0).max(1).optional(),
  /**
   * Retexture mode keeps composition and swaps the look. Requires imageUrls
   * (forces task = image_to_image) and a stylePackEntityId.
   */
  retexture: z.boolean().default(false),
  /**
   * When true (default), a universe with a canon style pack auto-applies it
   * even if no stylePackEntityId was passed. Fan creators can set this to
   * false to ignore canon and generate an alternate style.
   */
  respectCanonStyle: z.boolean().default(true),

  qualityTarget: z.enum(['draft', 'standard', 'premium']).optional(),
  costBudget: z.enum(['low', 'medium', 'any']).optional(),
  latencyPreference: z.enum(['fast', 'balanced', 'quality']).optional(),

  // Idempotency token — see docs/prd-mcp-integration.md §2.
  clientToken: z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, 'clientToken must match [A-Za-z0-9_-]{16,128}')
    .optional(),

  // Webhook delivery — signed POST on terminal state. See docs/prd-mcp-integration.md §2.
  webhookUrl: webhookUrlSchema.optional(),
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

// ── Provider dispatch ───────────────────────────────────────────────

function imageSizeToAspectRatio(size?: string): '1:1' | '3:4' | '4:3' | '9:16' | '16:9' {
  switch (size) {
    case 'portrait_4_3':
      return '3:4';
    case 'landscape_4_3':
      return '4:3';
    case 'portrait_16_9':
      return '9:16';
    case 'landscape_16_9':
      return '16:9';
    default:
      return '1:1';
  }
}

interface DispatchResult {
  status: 'completed' | 'failed';
  images?: Array<{ url: string }>;
  seed?: number;
  error?: string;
}

/**
 * Single dispatch path for all image providers. For Google, base64 results
 * are uploaded to permanent storage synchronously so the return value is a
 * URL just like FAL/ByteDance.
 */
async function dispatchImageGen(
  model: ImageModelConfig,
  input: z.infer<typeof generateSchema>,
  ctx: { userId: string; generationId: string }
): Promise<DispatchResult> {
  if (model.provider === 'google') {
    if (!googleImagenService.isConfigured()) {
      return { status: 'failed', error: 'GOOGLE_API_KEY is not configured' };
    }
    try {
      const result = await googleImagenService.generate({
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        numberOfImages: input.numImages,
        aspectRatio: imageSizeToAspectRatio(input.imageSize),
        model: (model.googleModelId as any) || 'nano-banana-pro-preview',
      });
      const manager = getStorageManager();
      const images: Array<{ url: string }> = [];
      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i];
        const filename = `generation-${ctx.generationId}-${i}.png`;
        const buf = Buffer.from(img.base64, 'base64');
        const signed = await signWithProvenance(buf, filename, {
          model: model.googleModelId || 'nano-banana-pro-preview',
          prompt: input.prompt,
          generatedAt: new Date().toISOString(),
          mimeType: img.mimeType || 'image/png',
        });
        const manifest = await manager.upload(
          signed,
          filename,
          img.mimeType || 'image/png',
          ctx.userId
        );
        const url = manifest.uploads[0]?.url;
        if (url) images.push({ url });
      }
      if (images.length === 0) {
        return { status: 'failed', error: 'Google returned no images (storage upload failed)' };
      }
      return { status: 'completed', images };
    } catch (err) {
      return {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Google API error',
      };
    }
  }

  if (model.provider === 'bytedance') {
    const result = await bytedanceService.generateImage({
      prompt: input.prompt,
      model: model.bytedanceModelId || 'seedream-5-0-260128',
      negativePrompt: input.negativePrompt,
      numImages: input.numImages,
      seed: input.seed,
    });
    if (result.status === 'completed' && result.images?.length) {
      return {
        status: 'completed',
        images: result.images.map((img) => ({ url: img.url })),
        seed: result.seed,
      };
    }
    return { status: 'failed', error: result.error || 'ByteDance returned no images' };
  }

  // FAL (default)
  if (!process.env.FAL_KEY) {
    return { status: 'failed', error: 'FAL_KEY is not configured' };
  }
  const result = await falService.generateImage({
    prompt: input.prompt,
    model: model.falModelId as any,
    negativePrompt: input.negativePrompt,
    imageSize: input.imageSize,
    numImages: input.numImages,
    seed: input.seed,
  });
  if (result.status === 'completed' && result.images?.length) {
    return {
      status: 'completed',
      images: result.images.map((img) => ({ url: img.url })),
      seed: result.seed,
    };
  }
  return { status: 'failed', error: result.error || 'FAL returned no images' };
}

async function attemptFallback(
  input: z.infer<typeof generateSchema>,
  failedModelId: string,
  ctx: { userId: string; generationId: string }
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
      const result = await dispatchImageGen(candidate, input, ctx);
      if (result.status === 'completed' && result.images?.length) {
        markImageProviderHealthy(candidate.provider);
        return {
          imageUrls: result.images.map((img) => img.url),
          fallbackModelId: candidate.id,
        };
      }
      markImageProviderUnhealthy(candidate.provider);
    } catch (err) {
      console.error(`[image] fallback ${candidate.id} threw:`, err);
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
      let imageBuffer: Buffer = Buffer.from(new Uint8Array(arrayBuf));

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

function autoPublishToGallery(opts: {
  creatorUid: string;
  imageUrls: string[];
  prompt: string;
  model: string;
  universeId?: string;
  generationId: string;
  /** Source image this was derived from (edit/img2img/controlled). */
  sourceImageUrl?: string;
  /** Parent generation id when the source itself came from a prior generation. */
  parentGenerationId?: string;
}): Promise<void> {
  return Promise.all(
    opts.imageUrls.map((url, i) =>
      publishToGallery({
        creatorUid: opts.creatorUid,
        mediaUrl: url,
        thumbnailUrl: url,
        mediaType: 'ai-image',
        title: opts.prompt.slice(0, 100) || 'Generated Image',
        description: opts.prompt,
        universeId: opts.universeId ?? null,
        generationId: opts.imageUrls.length > 1 ? `${opts.generationId}:${i}` : opts.generationId,
        generationModel: opts.model,
        sourceImageUrl: opts.sourceImageUrl ?? null,
        parentGenerationId: opts.parentGenerationId ?? null,
      })
    )
  ).then(() => undefined);
}

// ── Router ────────────────────────────────────────────────────────────

export const imageRouter = router({
  // ── Routed generation (new primary endpoint) ─────────────────────────

  // INF-6: FAL / Google Imagen image generation ($0.04–0.12 per call).
  generate: expensiveProcedure
    .use(requirePermission('generation.image'))
    .input(generateSchema)
    .mutation(async ({ input, ctx }) => {
      // Sanitize user-supplied prompts
      input.prompt = sanitizePrompt(input.prompt);
      if (input.negativePrompt) input.negativePrompt = sanitizePrompt(input.negativePrompt);

      // ── Wiki context injection ──────────────────────────────────────
      if (input.useWikiContext && (input.universeId || input.entityId)) {
        try {
          const wikiContext = await buildGenerationContext({
            universeId: input.universeId,
            entityId: input.entityId,
          });
          if (wikiContext) {
            input.prompt = `${wikiContext}\n\n${input.prompt}`;
          }
        } catch (err) {
          // Non-fatal — generation continues without wiki context
          console.warn('[image] Wiki context fetch failed:', err);
        }
      }

      // ── Style pack + moodboard composition (PRD 5) ───────────────────
      // Applied BEFORE reference bundle so identity-lock references retain
      // priority in the final imageUrls list. Retexture mode forces
      // image_to_image and requires both a source image and a style pack.
      let appliedStylePackId: string | null = null;
      let appliedMoodboardId: string | null = null;
      let appliedStyleStrength: number | null = null;
      try {
        const composition = await composeStyle({
          stylePackEntityId: input.stylePackEntityId,
          moodboardEntityId: input.moodboardEntityId,
          styleStrength: input.styleStrength,
          universeId: input.respectCanonStyle ? (input.universeId ?? null) : null,
        });
        if (composition.stylePrefix || composition.negativeAddendum) {
          const merged = applyStyleToPrompt(input.prompt, input.negativePrompt, composition);
          input.prompt = merged.prompt;
          input.negativePrompt = merged.negativePrompt;
        }
        // Moodboard + style pack references seed the img2img input list. The
        // reference bundle below may append more on top.
        if (composition.referenceImages.length > 0) {
          const existing = new Set(input.imageUrls ?? []);
          const merged = [...(input.imageUrls ?? [])];
          for (const url of composition.referenceImages) {
            if (!existing.has(url)) {
              merged.push(url);
              existing.add(url);
            }
          }
          input.imageUrls = merged;
        }
        appliedStylePackId = composition.appliedStylePackEntityId;
        appliedMoodboardId = composition.appliedMoodboardEntityId;
        appliedStyleStrength = composition.strength;
      } catch (err) {
        // Non-fatal — generation continues without style composition.
        console.warn('[image] Style composition failed:', err);
      }

      // Retexture mode: require a source image and a style pack, then force
      // img2img so the model preserves composition while swapping look.
      if (input.retexture) {
        if (!input.imageUrls || input.imageUrls.length === 0) {
          throw new Error('Retexture requires at least one source image (imageUrls)');
        }
        if (!appliedStylePackId) {
          throw new Error(
            'Retexture requires a style pack — pass stylePackEntityId or set a canon style on the universe'
          );
        }
        input.task = 'image_to_image';
      }

      // ── Reference bundle resolution (Feature 6) ──────────────────────
      // Resolves slots + locks from the target entity and its parent chain.
      // Reference URLs become image_to_image inputs (ahead of any the caller
      // supplied); lock hints are appended to the prompt so providers without
      // native identity-lock controls still see them.
      const bundleTargetIdImg =
        (input.useReferenceBundle ?? true) && (input.referenceBundleEntityId || input.entityId);
      if (bundleTargetIdImg) {
        try {
          const { resolveReferenceBundle, flattenReferenceUrls, buildLockPromptSuffix } =
            await import('../entities/entities.reference-bundle');
          const bundle = await resolveReferenceBundle(bundleTargetIdImg);
          if (bundle) {
            const bundleUrls = flattenReferenceUrls(bundle, 4);
            if (bundleUrls.length > 0) {
              const existing = new Set(input.imageUrls ?? []);
              const merged = [...(input.imageUrls ?? [])];
              for (const url of bundleUrls) {
                if (!existing.has(url)) {
                  merged.push(url);
                  existing.add(url);
                }
              }
              input.imageUrls = merged;
              if (input.task === 'text_to_image') input.task = 'image_to_image';
            }
            const lockSuffix = buildLockPromptSuffix(bundle);
            if (lockSuffix) input.prompt = `${input.prompt}. ${lockSuffix}`;
          }
        } catch (err) {
          console.warn('[image] Reference bundle resolution failed:', err);
          // Non-fatal — generation continues without the bundle
        }
      }

      const genId = randomUUID();

      // ── Idempotency (clientToken) ───────────────────────────────────
      // See docs/prd-mcp-integration.md §2. Prevents double-charge on retries.
      if (input.clientToken) {
        const reservation = await reserveClientToken({
          ownerUid: ctx.user.uid,
          clientToken: input.clientToken,
          jobId: genId,
          procedure: 'image.generate',
        });
        if (reservation?.existing) {
          const existingSnap = await imageGenerationsCol().doc(reservation.existing.jobId).get();
          const d = existingSnap.exists ? (existingSnap.data() as any) : {};
          return {
            generationId: reservation.existing.jobId,
            status: (d.status ?? 'queued') as 'queued' | 'completed' | 'failed',
            imageUrls: (d.imageUrls ?? []) as string[],
            seed: d.seed as number | undefined,
            modelUsed: (d.finalModelId ?? d.model ?? null) as string | null,
            modelDisplayName:
              (d.finalModelId ? getImageModelById(d.finalModelId)?.displayName : null) ?? null,
            routingMode: input.routingMode,
            reasonCode: (d.routingReasonCode ??
              'idempotent_replay') as ImageGenerationRecord['routingReasonCode'],
            creditsCharged: (d.creditsCharged ?? 0) as number,
            fiatPriceUsd: (d.fiatPriceUsd ?? 0) as number,
            wasFallback: Boolean(d.wasFallback),
            idempotentReplay: true as const,
          };
        }
      }

      // Validate webhookUrl early — fail before any billable work.
      let validatedWebhookUrl: string | undefined;
      if (input.webhookUrl) {
        const check = validateWebhookUrl(input.webhookUrl);
        if (!check.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });
        }
        validatedWebhookUrl = check.url;
      }

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
      // Style pack / moodboard provenance (PRD 5). Not typed on
      // ImageGenerationRecord yet — cast to record-with-extras so Firestore
      // persists them alongside the typed fields.
      const recordWithStyle = record as ImageGenerationRecord & {
        stylePackEntityId?: string | null;
        moodboardEntityId?: string | null;
        styleStrength?: number | null;
        retexture?: boolean;
        webhookUrl?: string;
        clientToken?: string;
      };
      recordWithStyle.stylePackEntityId = appliedStylePackId;
      recordWithStyle.moodboardEntityId = appliedMoodboardId;
      recordWithStyle.styleStrength = appliedStyleStrength;
      recordWithStyle.retexture = input.retexture ?? false;
      if (validatedWebhookUrl) recordWithStyle.webhookUrl = validatedWebhookUrl;
      if (input.clientToken) recordWithStyle.clientToken = input.clientToken;
      await saveRecord(recordWithStyle);

      // ── Deduct credits ───────────────────────────────────────────────
      if (!db) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Server storage is not configured — cannot deduct credits',
        });
      }
      const userCreditsRef = db.collection('userCredits').doc(ctx.user.uid);
      let insufficientCredits = false;
      try {
        await db.runTransaction(async (tx) => {
          const doc = await tx.get(userCreditsRef);
          const balance = doc.exists ? doc.data()?.balance || 0 : 0;
          if (balance < totalCredits) {
            insufficientCredits = true;
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
        const message = err instanceof Error ? err.message : 'Credit deduction failed';
        await imageGenerationsCol()
          .doc(genId)
          .update({ status: 'failed', failureReason: message, completedAt: new Date() });
        if (insufficientCredits) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }

      // ── Generate ─────────────────────────────────────────────────────
      try {
        await imageGenerationsCol().doc(genId).update({ status: 'running' });

        const result = await dispatchImageGen(model, input, {
          userId: ctx.user.uid,
          generationId: genId,
        });

        if (result.status !== 'completed' || !result.images?.length) {
          markImageProviderUnhealthy(model.provider);

          if (input.allowFallback) {
            const fallback = await attemptFallback(input, model.id, {
              userId: ctx.user.uid,
              generationId: genId,
            });
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

              fireJobWebhook({
                ownerUid: ctx.user.uid,
                webhookUrl: validatedWebhookUrl,
                clientToken: input.clientToken,
                event: 'job.completed',
                jobId: genId,
                kind: 'image',
                payload: {
                  status: 'completed',
                  imageUrls: fallback.imageUrls,
                  modelUsed: fallback.fallbackModelId,
                  wasFallback: true,
                  creditsCharged: totalCredits,
                },
              });

              return {
                generationId: genId,
                status: 'completed' as const,
                imageUrls: fallback.imageUrls,
                seed: undefined as number | undefined,
                modelUsed: fallback.fallbackModelId,
                modelDisplayName:
                  getImageModelById(fallback.fallbackModelId)?.displayName ||
                  fallback.fallbackModelId,
                routingMode: input.routingMode,
                reasonCode,
                creditsCharged: totalCredits,
                fiatPriceUsd: totalFiat,
                wasFallback: true,
                idempotentReplay: false as const,
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
          // Map provider-config errors to SERVICE_UNAVAILABLE so the client
          // sees a clear 503 instead of a generic 500.
          const isConfigError = /API_KEY|FAL_KEY|GOOGLE_API_KEY|not configured/i.test(failReason);
          throw new TRPCError({
            code: isConfigError ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_SERVER_ERROR',
            message: failReason,
          });
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

        // PRD 10: generate lineage event
        {
          const promptRefs: PromptRef[] = (input.imageUrls ?? []).map((url) => ({
            kind: 'image',
            url,
          }));
          recordAssetEventAsync({
            assetId: genId,
            parentAssetId: null,
            kind: 'generate',
            tool: finalModelId,
            step: input.task === 'image_to_image' ? 'image_to_image' : 'text_to_image',
            prompt: input.prompt,
            promptRefs,
            modelId: finalModelId,
            modelProvider: model.provider,
            creditCost: totalCredits,
            latencyMs,
            creatorUid: ctx.user.uid,
            creatorAddress: ctx.user.address ?? null,
            universeId: input.universeId ?? null,
            outputUrl: imageUrls[0] ?? null,
            outputKind: 'image',
            status: 'completed',
          });
        }

        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.completed',
          jobId: genId,
          kind: 'image',
          payload: {
            status: 'completed',
            imageUrls,
            modelUsed: finalModelId,
            wasFallback: false,
            creditsCharged: totalCredits,
          },
        });

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
          idempotentReplay: false as const,
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
        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.failed',
          jobId: genId,
          kind: 'image',
          payload: {
            status: 'failed',
            errorMessage,
            creditsRefunded: !alreadyRefunded,
          },
        });
        throw error;
      }
    }),

  // ── Controlled generation (PRD 7) ────────────────────────────────────
  //
  // Multi-reference conditioning using guide images (pose, scribble, depth,
  // style, subject, previous-shot) plus optional angle preset. Pinned to
  // the Google nano-banana-pro-preview model which natively accepts
  // interleaved text + image parts via generateContent.
  // INF-6: ControlNet/guided image generation (paid FAL pipeline).
  generateControlled: expensiveProcedure
    .use(requirePermission('generation.image'))
    .input(
      z.object({
        prompt: z.string().min(1, 'Prompt is required'),
        negativePrompt: z.string().optional(),
        imageSize: imageSizeSchema.default('square_hd'),
        numImages: z.number().min(1).max(4).default(1),
        anglePreset: z.string().nullable().default(null),
        controls: z
          .array(
            z.object({
              controlType: z.enum(CONTROL_TYPES),
              guideImageUrl: z.string().url(),
              strength: z.number().min(0).max(1),
            })
          )
          .min(1, 'At least one control reference is required')
          .max(8),
        entityId: z.string().optional(),
        universeId: z.string().optional(),
        useWikiContext: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      input.prompt = sanitizePrompt(input.prompt);
      if (input.negativePrompt) input.negativePrompt = sanitizePrompt(input.negativePrompt);

      // Wiki context injection (same as image.generate)
      if (input.useWikiContext && (input.universeId || input.entityId)) {
        try {
          const wikiContext = await buildGenerationContext({
            universeId: input.universeId,
            entityId: input.entityId,
          });
          if (wikiContext) {
            input.prompt = `${wikiContext}\n\n${input.prompt}`;
          }
        } catch (err) {
          console.warn('[image] Wiki context fetch failed:', err);
        }
      }

      const genId = randomUUID();
      const startTime = Date.now();

      // Pin to the Google nano-banana-2 model
      const model = getImageModelById('nano-banana-2');
      if (!model) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Controlled generation model is not registered',
        });
      }
      if (!googleImagenService.isConfigured()) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'GOOGLE_API_KEY is not configured',
        });
      }

      const totalCredits = model.creditCostPerImage * input.numImages;
      const totalFiat = model.fiatPriceUsd * input.numImages;
      const totalLoar = model.loarPriceUsd * input.numImages;
      const totalProvider = model.providerCostUsd * input.numImages;

      // Save initial record
      const record: ImageGenerationRecord = {
        id: genId,
        userId: ctx.user.uid,
        entityId: input.entityId,
        universeId: input.universeId,
        routingMode: 'manual',
        requestedModelId: model.id,
        finalModelId: model.id,
        provider: model.provider,
        status: 'queued',
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        task: 'image_to_image',
        imageSize: input.imageSize,
        numImages: input.numImages,
        providerCostUsd: totalProvider,
        fiatPriceUsd: totalFiat,
        loarPriceUsd: totalLoar,
        creditsCharged: totalCredits,
        marginUsd: totalFiat - totalProvider,
        routingReasonCode: 'manual_user_selection',
        createdAt: new Date(),
      };
      await saveRecord(record);

      // Deduct credits
      if (!db) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Server storage is not configured — cannot deduct credits',
        });
      }
      const userCreditsRef = db.collection('userCredits').doc(ctx.user.uid);
      let insufficientCredits = false;
      try {
        await db.runTransaction(async (tx) => {
          const doc = await tx.get(userCreditsRef);
          const balance = doc.exists ? doc.data()?.balance || 0 : 0;
          if (balance < totalCredits) {
            insufficientCredits = true;
            throw new Error(`Insufficient credits. Need ${totalCredits}, have ${balance}.`);
          }
          tx.update(userCreditsRef, {
            balance: balance - totalCredits,
            totalSpent: (doc.data()?.totalSpent || 0) + totalCredits,
            updatedAt: new Date(),
          });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Credit deduction failed';
        await imageGenerationsCol()
          .doc(genId)
          .update({ status: 'failed', failureReason: message, completedAt: new Date() });
        if (insufficientCredits) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }

      try {
        await imageGenerationsCol().doc(genId).update({ status: 'running' });

        // Fetch guide images concurrently → base64
        const controls: ControlInput[] = input.controls.map((c) => ({
          controlType: c.controlType,
          guideImageUrl: c.guideImageUrl,
          strength: c.strength,
        }));

        const { validateUploadUrl } = await import('../../lib/url-validator');
        const inputImages = await Promise.all(
          controls.map(async (c) => {
            await validateUploadUrl(c.guideImageUrl);
            const res = await fetch(c.guideImageUrl, { redirect: 'error' });
            if (!res.ok) {
              throw new Error(`Failed to fetch guide image: ${res.status} ${res.statusText}`);
            }
            const mimeType = res.headers.get('content-type') || 'image/png';
            if (!mimeType.startsWith('image/')) {
              throw new Error('Guide image URL did not return an image response');
            }
            const buf = Buffer.from(await res.arrayBuffer());
            return { base64: buf.toString('base64'), mimeType };
          })
        );

        // Build final prompt: preamble + angle preset + user prompt
        const preamble = buildControlPreamble(controls);
        const anglePrompt = applyAnglePreset(input.prompt, input.anglePreset);
        const finalPrompt = preamble ? `${preamble}\n\n${anglePrompt}` : anglePrompt;

        const result = await googleImagenService.generate({
          prompt: finalPrompt,
          negativePrompt: input.negativePrompt,
          numberOfImages: input.numImages,
          aspectRatio: imageSizeToAspectRatio(input.imageSize),
          model: 'nano-banana-pro-preview',
          inputImages,
        });

        // Persist images through storage manager
        const manager = getStorageManager();
        const imageUrls: string[] = [];
        for (let i = 0; i < result.images.length; i++) {
          const img = result.images[i];
          const filename = `controlled-${genId}-${i}.png`;
          const buf = Buffer.from(img.base64, 'base64');
          const signed = await signWithProvenance(buf, filename, {
            model: 'nano-banana-pro-preview',
            prompt: finalPrompt,
            generatedAt: new Date().toISOString(),
            mimeType: img.mimeType || 'image/png',
          });
          const manifest = await manager.upload(
            signed,
            filename,
            img.mimeType || 'image/png',
            ctx.user.uid
          );
          const url = manifest.uploads[0]?.url;
          if (url) imageUrls.push(url);
        }

        if (imageUrls.length === 0) {
          throw new Error('Google returned no images (storage upload failed)');
        }

        markImageProviderHealthy('google');
        const latencyMs = Date.now() - startTime;

        await imageGenerationsCol().doc(genId).update({
          status: 'completed',
          imageUrls,
          latencyMs,
          completedAt: new Date(),
          controls: input.controls,
          anglePreset: input.anglePreset,
        });

        // Auto-attach to entity and publish to gallery (same as image.generate)
        autoAttachImages({
          creator: ctx.user.uid,
          entityId: input.entityId,
          generationId: genId,
          imageUrls,
          prompt: input.prompt,
        }).catch((err) => console.error('[controlled] attach failed:', err.message));

        autoPublishToGallery({
          creatorUid: ctx.user.uid,
          imageUrls,
          prompt: input.prompt,
          model: model.id,
          universeId: input.universeId,
          generationId: genId,
        }).catch((err) => console.error('[controlled] gallery publish failed:', err.message));

        try {
          trackQuests(ctx.user.uid, [
            { questId: 'first_image_generation' },
            { questId: 'daily_generation' },
          ]);
        } catch (err) {
          console.error('[controlled] quest tracking failed:', err);
        }

        return {
          generationId: genId,
          status: 'completed' as const,
          imageUrls,
          modelUsed: model.id,
          modelDisplayName: model.displayName,
          creditsCharged: totalCredits,
          fiatPriceUsd: totalFiat,
        };
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        markImageProviderUnhealthy('google');

        // Refund
        try {
          await userCreditsRef.update({
            balance: FieldValue.increment(totalCredits),
            totalSpent: FieldValue.increment(-totalCredits),
            updatedAt: new Date(),
          });
        } catch (refundErr) {
          console.error(`CRITICAL: controlled-gen refund failed for ${ctx.user.uid}:`, refundErr);
          logFailedRefund({
            userId: ctx.user.uid,
            credits: totalCredits,
            source: 'image.generateControlled',
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

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: errorMessage,
        });
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

  // INF-6: alternative image-gen entry (paid FAL pipeline).
  generateImage: expensiveProcedure
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
      await deductLegacyCredits(ctx.user.uid, cost);
      input.prompt = sanitizePrompt(input.prompt);
      if (input.negativePrompt) input.negativePrompt = sanitizePrompt(input.negativePrompt);
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

  // INF-6: paid FAL inpaint/outpaint edit.
  editImage: expensiveProcedure
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
      await deductLegacyCredits(ctx.user.uid, cost);
      input.prompt = sanitizePrompt(input.prompt);
      if (input.negativePrompt) input.negativePrompt = sanitizePrompt(input.negativePrompt);
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
          sourceImageUrl: input.imageUrls[0],
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

  // INF-6: image-to-image transform (paid FAL pipeline).
  imageToImage: expensiveProcedure
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
      await deductLegacyCredits(ctx.user.uid, cost);
      input.prompt = sanitizePrompt(input.prompt);
      if (input.negativePrompt) input.negativePrompt = sanitizePrompt(input.negativePrompt);
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
          sourceImageUrl: input.imageUrls[0],
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

  // INF-6: character portrait generation (Imagen).
  generateCharacter: expensiveProcedure
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
    .mutation(async ({ ctx, input }) => {
      // Charge credits atomically. Without this any signed-in user could
      // burn FAL spend in a loop without a balance cost.
      const cost = 3;
      await deductLegacyCredits(ctx.user.uid, cost);

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

      let imageResult;
      try {
        imageResult = await falService.generateImage({
          prompt: fullPrompt,
          model: 'fal-ai/nano-banana',
          imageSize: 'square_hd',
          numImages: 1,
        });
      } catch (genError) {
        if (db) {
          await db
            .collection('userCredits')
            .doc(ctx.user.uid)
            .update({ balance: FieldValue.increment(cost), updatedAt: new Date() })
            .catch(() => {});
        }
        throw genError;
      }

      if (imageResult.status !== 'completed' || !imageResult.imageUrl) {
        if (db) {
          await db
            .collection('userCredits')
            .doc(ctx.user.uid)
            .update({ balance: FieldValue.increment(cost), updatedAt: new Date() })
            .catch(() => {});
        }
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
            // Tag the creator so downstream ownership checks can gate edits.
            creator_uid: ctx.user.uid,
            creator_address: ctx.user.address?.toLowerCase() || null,
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
    .mutation(async ({ ctx, input }) => {
      // analyzeCharacter calls Gemini on an arbitrary user-supplied URL.
      // Charge a small credit cost so this isn't a free vector for burning
      // provider spend, and validate the URL for SSRF before Gemini opens it.
      const cost = 1;
      await deductLegacyCredits(ctx.user.uid, cost);
      try {
        const { validateUploadUrl } = await import('../../lib/url-validator');
        await validateUploadUrl(input.imageUrl);
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
        if (db) {
          await db
            .collection('userCredits')
            .doc(ctx.user.uid)
            .update({ balance: FieldValue.increment(cost), updatedAt: new Date() })
            .catch(() => {});
        }
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
    .mutation(async ({ ctx, input }) => {
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
          // Tag the creator so the character can be revoked/edited only
          // by the person who saved it.
          creator_uid: ctx.user.uid,
          creator_address: ctx.user.address?.toLowerCase() || null,
          created_at: new Date(),
          updated_at: new Date(),
        });
      return { success: true, characterId, characterName: input.name, imageUrl: input.imageUrl };
    }),
});

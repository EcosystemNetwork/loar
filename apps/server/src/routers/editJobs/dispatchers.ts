/**
 * Per-op dispatcher for the Edit Canvas.
 *
 * Each edit op variant resolves to one service path:
 *   inpaint   → falService.inpaintImage     (FLUX Fill)
 *   outpaint  → googleImagenService          (nano-banana-pro-preview) w/ FAL fallback
 *   relight   → falService.editImage         (nano-banana/edit) + preset composer
 *   retexture → falService.editImage         (nano-banana/edit) + texture composer
 *
 * Each dispatcher returns a uniform `DispatchResult` so the tRPC route can
 * handle success/failure consistently.
 */

import { falService } from '../../services/fal';
import { googleImagenService } from '../../services/google-imagen';
import { getStorageManager } from '../../services/storage';
import { signWithProvenance } from '../../services/provenance';
import { getEditingModelById } from '../../services/editing-models';
import { resolveProviderKey } from '../../lib/byok';
import type { EditOp } from './editJobs.types';

export interface DispatchSuccess {
  status: 'ok';
  outputUrl: string;
  seed: number | null;
  modelId: string;
  modelDisplayName: string;
  providerCostUsd: number;
  creditsCharged: number;
  prompt: string | null;
  negativePrompt: string | null;
  maskUrl: string | null;
}
export interface DispatchFailure {
  status: 'error';
  error: string;
  /** Credit cost that was deducted before dispatch — routes layer uses this
   * for refunds. */
  creditsToRefund: number;
}
export type DispatchResult = DispatchSuccess | DispatchFailure;

// ── Inpaint ─────────────────────────────────────────────────────────────

export async function dispatchInpaint(args: {
  op: Extract<EditOp, { kind: 'inpaint' }>;
  inputUrl: string;
  maskUrl: string;
  userId: string;
  creditCost: number;
}): Promise<DispatchResult> {
  const { op, inputUrl, maskUrl, userId, creditCost } = args;
  const model = getEditingModelById(op.modelId);
  if (!model || model.operation !== 'inpaint') {
    return { status: 'error', error: 'Invalid inpaint model', creditsToRefund: creditCost };
  }
  const { prompt, negativePrompt } = composeInpaintPrompt(op.mode, op.prompt);
  const finalNegative = op.negativePrompt
    ? `${negativePrompt}, ${op.negativePrompt}`
    : negativePrompt;

  const apiKey = await resolveProviderKey(userId, 'fal');
  const result = await falService.inpaintImage({
    imageUrl: inputUrl,
    maskUrl,
    prompt,
    model: model.falModelId,
    negativePrompt: finalNegative,
    seed: op.seed,
    strength: op.strength,
    guidanceScale: op.guidanceScale,
    apiKey,
  });

  if (result.status === 'failed' || !result.imageUrl) {
    return {
      status: 'error',
      error: result.error || 'Inpaint failed',
      creditsToRefund: creditCost,
    };
  }
  return {
    status: 'ok',
    outputUrl: result.imageUrl,
    seed: result.seed ?? op.seed ?? null,
    modelId: model.id,
    modelDisplayName: model.displayName,
    providerCostUsd: model.providerCostUsd,
    creditsCharged: creditCost,
    prompt: op.prompt,
    negativePrompt: op.negativePrompt ?? null,
    maskUrl,
  };
}

// ── Outpaint (Gemini primary, FAL fallback) ────────────────────────────

/** Flat per-op credit cost for outpaint — mirrors outpaintRouter pricing. */
const OUTPAINT_CREDIT_COST = 135; // 1.35 * $0.04 / $0.01 ≈ matches nano-banana-2 tier
const OUTPAINT_PROVIDER_COST_USD = 0.04;

export async function dispatchOutpaint(args: {
  op: Extract<EditOp, { kind: 'outpaint' }>;
  inputUrl: string;
  userId: string;
  jobId: string;
  creditCost: number;
}): Promise<DispatchResult> {
  const { op, inputUrl, userId, jobId, creditCost } = args;

  const source = await fetchAsInlineImage(inputUrl).catch((err) => ({ error: err as Error }));
  if ('error' in source) {
    return {
      status: 'error',
      error: `Failed to fetch source: ${source.error.message}`,
      creditsToRefund: creditCost,
    };
  }

  const composed = buildOutpaintPrompt(op);

  const [googleKey, falKey] = await Promise.all([
    resolveProviderKey(userId, 'google'),
    resolveProviderKey(userId, 'fal'),
  ]);

  // Primary: Google Gemini (nano-banana-pro-preview) supports inline image
  if (googleKey) {
    try {
      const result = await googleImagenService.generate({
        prompt: composed,
        negativePrompt: op.negativePrompt,
        numberOfImages: 1,
        model: 'nano-banana-pro-preview',
        inputImages: [source],
        apiKey: googleKey,
      });
      const img = result.images?.[0];
      if (img) {
        const buffer = Buffer.from(img.base64, 'base64');
        const filename = `outpaint-${jobId}.png`;
        const signed = await signWithProvenance(buffer, filename, {
          model: 'nano-banana-pro-preview',
          prompt: composed,
          generatedAt: new Date().toISOString(),
          mimeType: img.mimeType || 'image/png',
        });
        const manifest = await getStorageManager().upload(
          signed,
          filename,
          img.mimeType || 'image/png',
          userId
        );
        const url = manifest.uploads[0]?.url;
        if (url) {
          return {
            status: 'ok',
            outputUrl: url,
            seed: null,
            modelId: 'nano-banana-pro-preview',
            modelDisplayName: 'Nano Banana Pro Outpaint',
            providerCostUsd: OUTPAINT_PROVIDER_COST_USD,
            creditsCharged: creditCost,
            prompt: composed,
            negativePrompt: op.negativePrompt ?? null,
            maskUrl: null,
          };
        }
      }
    } catch (err) {
      console.error('[editJobs outpaint] Gemini dispatch failed, trying FAL fallback:', err);
    }
  }

  // Fallback: FAL nano-banana/edit (image-to-image)
  if (falKey) {
    const result = await falService.imageToImage({
      prompt: composed,
      imageUrls: [inputUrl],
      numImages: 1,
      apiKey: falKey,
    });
    const url = result.images?.[0]?.url || result.imageUrl;
    if (url) {
      return {
        status: 'ok',
        outputUrl: url,
        seed: result.seed ?? null,
        modelId: 'fal-ai/nano-banana/edit',
        modelDisplayName: 'Nano Banana Outpaint (FAL)',
        providerCostUsd: OUTPAINT_PROVIDER_COST_USD,
        creditsCharged: creditCost,
        prompt: composed,
        negativePrompt: op.negativePrompt ?? null,
        maskUrl: null,
      };
    }
    return {
      status: 'error',
      error: result.error || 'FAL outpaint fallback returned no image',
      creditsToRefund: creditCost,
    };
  }

  return {
    status: 'error',
    error:
      'No image provider configured — set GOOGLE_API_KEY/FAL_KEY env or add a key in /settings/api-keys',
    creditsToRefund: creditCost,
  };
}

export function getOutpaintCreditCost(): number {
  return OUTPAINT_CREDIT_COST;
}

// ── Relight ────────────────────────────────────────────────────────────

export async function dispatchRelight(args: {
  op: Extract<EditOp, { kind: 'relight' }>;
  inputUrl: string;
  userId: string;
  tonePack: {
    presetIds?: string[];
    customPromptFragment?: string;
    customNegativeFragment?: string;
  } | null;
  creditCost: number;
}): Promise<DispatchResult> {
  const { op, inputUrl, userId, tonePack, creditCost } = args;
  const model = getEditingModelById(op.modelId);
  if (!model || model.operation !== 'relight') {
    return { status: 'error', error: 'Invalid relight model', creditsToRefund: creditCost };
  }

  const { composeRelightPrompt } = await import('../../services/relight/presets');
  const composed = composeRelightPrompt({
    presetIds: op.presetIds,
    freeText: op.freeText,
    tonePack,
  });

  if (!composed.prompt.trim()) {
    return {
      status: 'error',
      error: 'Pick at least one preset or enter free-text guidance',
      creditsToRefund: creditCost,
    };
  }

  const apiKey = await resolveProviderKey(userId, 'fal');
  const result = await falService.editImage({
    prompt: composed.prompt,
    imageUrls: [inputUrl],
    numImages: 1,
    negativePrompt: composed.negativePrompt || undefined,
    apiKey,
  });

  if (result.status === 'failed' || !result.imageUrl) {
    return {
      status: 'error',
      error: result.error || 'Relight failed',
      creditsToRefund: creditCost,
    };
  }

  return {
    status: 'ok',
    outputUrl: result.imageUrl,
    seed: result.seed ?? null,
    modelId: model.id,
    modelDisplayName: model.displayName,
    providerCostUsd: model.providerCostUsd,
    creditsCharged: creditCost,
    prompt: composed.prompt,
    negativePrompt: composed.negativePrompt,
    maskUrl: null,
  };
}

// ── Retexture ──────────────────────────────────────────────────────────

export async function dispatchRetexture(args: {
  op: Extract<EditOp, { kind: 'retexture' }>;
  inputUrl: string;
  userId: string;
  creditCost: number;
}): Promise<DispatchResult> {
  const { op, inputUrl, userId, creditCost } = args;
  const model = getEditingModelById(op.modelId);
  if (!model || model.operation !== 'retexture') {
    return { status: 'error', error: 'Invalid retexture model', creditsToRefund: creditCost };
  }

  const prompt = composeRetexturePrompt(op.prompt);
  const neg = op.negativePrompt
    ? `changed subject identity, different geometry, deformed anatomy, blurry, ${op.negativePrompt}`
    : 'changed subject identity, different geometry, deformed anatomy, blurry';

  const apiKey = await resolveProviderKey(userId, 'fal');
  const result = await falService.editImage({
    prompt,
    imageUrls: [inputUrl],
    numImages: 1,
    negativePrompt: neg,
    apiKey,
  });

  if (result.status === 'failed' || !result.imageUrl) {
    return {
      status: 'error',
      error: result.error || 'Retexture failed',
      creditsToRefund: creditCost,
    };
  }

  return {
    status: 'ok',
    outputUrl: result.imageUrl,
    seed: result.seed ?? null,
    modelId: model.id,
    modelDisplayName: model.displayName,
    providerCostUsd: model.providerCostUsd,
    creditsCharged: creditCost,
    prompt,
    negativePrompt: neg,
    maskUrl: null,
  };
}

// ── Prompt composers ───────────────────────────────────────────────────

const UNIVERSAL_NEGATIVE =
  'blurry, low quality, watermark, jpeg artifacts, extra limbs, deformed, seams, halo';

function composeInpaintPrompt(
  mode: 'replace' | 'remove' | 'add' | 'fix',
  userPrompt: string
): { prompt: string; negativePrompt: string } {
  const trimmed = (userPrompt || '').trim();
  switch (mode) {
    case 'remove':
      return {
        prompt: trimmed
          ? `clean background, seamless fill matching surroundings, ${trimmed}, photorealistic, no object, empty space`
          : 'clean background, seamless fill matching surroundings, photorealistic, no object, empty space',
        negativePrompt: `${UNIVERSAL_NEGATIVE}, any object, figure, text, logo, character`,
      };
    case 'add':
      return {
        prompt: trimmed
          ? `${trimmed}, seamlessly integrated, matching lighting and perspective, photorealistic detail`
          : 'new object, seamlessly integrated, matching lighting and perspective',
        negativePrompt: UNIVERSAL_NEGATIVE,
      };
    case 'fix':
      return {
        prompt: trimmed
          ? `${trimmed}, highly detailed, anatomically correct, sharp focus, high quality`
          : 'highly detailed, anatomically correct, sharp focus, high quality, natural proportions',
        negativePrompt: `${UNIVERSAL_NEGATIVE}, malformed, mutated, bad anatomy, bad hands, extra fingers, fused fingers, disfigured`,
      };
    case 'replace':
    default:
      return { prompt: trimmed, negativePrompt: UNIVERSAL_NEGATIVE };
  }
}

function describeAnchor(anchorX: number, anchorY: number): string {
  const x = anchorX < 0.33 ? 'left' : anchorX > 0.66 ? 'right' : 'horizontally centered';
  const y = anchorY < 0.33 ? 'top' : anchorY > 0.66 ? 'bottom' : 'vertically centered';
  if (x === 'horizontally centered' && y === 'vertically centered') return 'centered';
  return `anchored to the ${y}-${x}`
    .replace('horizontally centered-', '')
    .replace('-vertically centered', '');
}

function buildOutpaintPrompt(op: Extract<EditOp, { kind: 'outpaint' }>): string {
  const { targetAspect, anchorX, anchorY, zoomFactor, mode, prompt } = op;
  const anchor = describeAnchor(anchorX, anchorY);
  const zoom =
    zoomFactor <= 1.05
      ? 'fits the new canvas edge-to-edge'
      : zoomFactor < 1.6
        ? `is zoomed out ~${zoomFactor.toFixed(1)}x, leaving room around it to be filled in`
        : `is zoomed out ${zoomFactor.toFixed(1)}x — the original occupies the center region and new background fills the rest`;

  const intent =
    mode === 'preserve'
      ? 'Preserve the original subject, composition, and style exactly. Extend the scene outward by generating new content that seamlessly continues the existing environment, lighting, perspective, and color grading. Do not alter the original region.'
      : 'Use the original image as creative inspiration for the center region. Extend outward with new scenery that matches the overall mood and tone, but you may enrich details and add cinematic elements consistent with the user guidance.';

  const guidance = prompt.trim() ? `User guidance for the expanded regions: ${prompt.trim()}` : '';

  return [
    `Reframe this image to a ${targetAspect} aspect ratio.`,
    `The original image ${anchor} within the new canvas and ${zoom}.`,
    intent,
    guidance,
    'The result must be a single cohesive image with seamless blending at the original boundaries — no visible seams, no duplicated subjects, no text overlays, no watermarks.',
  ]
    .filter(Boolean)
    .join(' ');
}

function composeRetexturePrompt(userPrompt: string): string {
  return [
    'preserve the exact subject identity, pose, silhouette, composition, and framing',
    'retexture only the material surfaces — change the material, fabric, finish, or pattern as described while keeping geometry identical',
    userPrompt.trim(),
    'photorealistic, high-detail material rendering, plausible reflections and shading',
  ]
    .filter(Boolean)
    .join('. ');
}

// ── Helpers ────────────────────────────────────────────────────────────

async function fetchAsInlineImage(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`source fetch failed (${response.status})`);
  const contentType = response.headers.get('content-type') || '';
  const mimeType = contentType.startsWith('image/')
    ? contentType.split(';')[0].trim()
    : url.match(/\.jpe?g(?:[?#]|$)/i)
      ? 'image/jpeg'
      : 'image/png';
  const buf = Buffer.from(new Uint8Array(await response.arrayBuffer()));
  if (buf.length === 0) throw new Error('source image is empty');
  if (buf.length > 20 * 1024 * 1024) throw new Error('source exceeds 20MB');
  return { base64: buf.toString('base64'), mimeType };
}

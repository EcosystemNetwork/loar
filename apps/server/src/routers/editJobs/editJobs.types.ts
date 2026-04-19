/**
 * Edit Canvas — shared types + Zod schemas.
 *
 * The Edit Canvas is the asset-scoped, versioned edit surface at
 * /studio/edit/$assetId. It wraps the existing `editing` router (and its
 * FAL-backed models) with three new Firestore collections:
 *   - assetVersions  : non-destructive version chain per `content` doc
 *   - editSessions   : ephemeral client state (layers, masks, undo/redo)
 *   - editJobs       : one record per dispatched edit op
 */

import { z } from 'zod';

// ── Zod schemas ─────────────────────────────────────────────────────────

export const OUTPAINT_ASPECTS = ['1:1', '4:5', '16:9', '9:16', '21:9'] as const;
export type OutpaintAspect = (typeof OUTPAINT_ASPECTS)[number];

/**
 * Single edit operation in an ops-plan. Each variant maps to a specific
 * service path: inpaint → falService.inpaintImage, outpaint → Google
 * nano-banana-pro with FAL fallback, relight → falService.editImage +
 * preset composer, retexture → falService.editImage + texture composer.
 */
export const editOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('inpaint'),
    maskId: z.string().min(1),
    prompt: z.string().default(''),
    mode: z.enum(['replace', 'remove', 'add', 'fix']).default('replace'),
    modelId: z.string().default('inpaint-flux'),
    negativePrompt: z.string().optional(),
    seed: z.number().int().optional(),
    strength: z.number().min(0).max(1).optional(),
    guidanceScale: z.number().min(1).max(20).optional(),
  }),
  z.object({
    kind: z.literal('outpaint'),
    targetAspect: z.enum(OUTPAINT_ASPECTS),
    anchorX: z.number().min(0).max(1).default(0.5),
    anchorY: z.number().min(0).max(1).default(0.5),
    zoomFactor: z.number().min(1).max(4).default(1),
    mode: z.enum(['preserve', 'creative']).default('preserve'),
    prompt: z.string().max(1000).default(''),
    negativePrompt: z.string().max(500).optional(),
  }),
  z.object({
    kind: z.literal('relight'),
    presetIds: z.array(z.string()).max(8).default([]),
    freeText: z.string().max(500).optional(),
    tonePackId: z.string().optional(),
    modelId: z.string().default('relight-nano-banana'),
  }),
  z.object({
    kind: z.literal('retexture'),
    prompt: z.string().min(1).max(500),
    negativePrompt: z.string().max(500).optional(),
    modelId: z.string().default('retexture-nano-banana'),
  }),
]);

export type EditOp = z.infer<typeof editOpSchema>;

export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export const layerStateSchema = z.object({
  id: z.string(),
  kind: z.enum(['source', 'mask', 'preview', 'overlay']),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
});
export type LayerState = z.infer<typeof layerStateSchema>;

// ── Firestore doc shapes ────────────────────────────────────────────────

export interface AssetVersion {
  id: string;
  contentId: string;
  parentVersionId: string | null;
  rootVersionId: string;
  versionNumber: number;
  label: string;
  mediaUrl: string;
  contentHash: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  mediaType: 'image' | 'ai-image' | 'video' | 'ai-video';
  isCurrent: boolean;
  createdBy: string;
  createdAt: Date;
  editJobId: string | null;
  rightsDeclaration: 'fan' | 'original' | 'licensed' | null;
  provenance: {
    model: string | null;
    prompt: string | null;
    ops: EditOp[];
  };
}

export interface EditSession {
  id: string;
  contentId: string;
  baseVersionId: string | null;
  userId: string;
  aspectRatio: string | null;
  layers: LayerState[];
  maskUploads: Array<{
    id: string;
    contentHash: string;
    url: string;
    createdAt: Date;
  }>;
  /** When the base version is a video, the user captures a frame to edit.
   * This URL is used as the working surface for image-based ops; the
   * resulting version is still chained to the video parent. */
  capturedFrameUrl: string | null;
  capturedFrameTime: number | null;
  lastSavedAt: Date;
  createdAt: Date;
  status: 'open' | 'submitted' | 'discarded';
}

export interface EditJobRecord {
  id: string;
  userId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  operation:
    | 'inpaint'
    | 'outpaint'
    | 'relight'
    | 'retexture'
    | 'upscale'
    | 'remove_bg'
    | 'restyle'
    | 'extend';
  modelId: string;
  contentId: string;
  sessionId: string | null;
  baseVersionId: string | null;
  resultVersionId: string | null;
  inputUrl: string;
  outputUrl: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  maskUrl: string | null;
  seed: number | null;
  providerCostUsd: number;
  creditsCharged: number;
  latencyMs: number | null;
  failureReason: string | null;
  opsPlan: EditOp[];
  aspectRatio: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

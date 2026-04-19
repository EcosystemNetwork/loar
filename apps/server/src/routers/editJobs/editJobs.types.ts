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

/**
 * Single edit operation in an ops-plan. v1 supports inpaint only; more
 * operations will light up as their registry entries land.
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
  lastSavedAt: Date;
  createdAt: Date;
  status: 'open' | 'submitted' | 'discarded';
}

export interface EditJobRecord {
  id: string;
  userId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  operation: 'inpaint' | 'upscale' | 'remove_bg' | 'relight' | 'restyle' | 'extend';
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

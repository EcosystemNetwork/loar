/**
 * Asset Lineage types — PRD 10.
 *
 * An AssetEvent is a single node in the asset family tree. Each event
 * represents one generation/edit/publish step and links to its parent via
 * parentAssetId. The rootAssetId field is denormalised so universe-wide
 * analytics can compute "most-remixed assets" without walking the chain.
 *
 * Doc id in Firestore = assetId (generationId | editJobId | contentId) so
 * writers can upsert idempotently and readers can fetch provenance by id.
 */

export type AssetEventKind = 'generate' | 'edit' | 'variation' | 'animation' | 'publish';

export type AssetEventStep =
  | 'text_to_image'
  | 'image_to_image'
  | 'text_to_video'
  | 'image_to_video'
  | 'upscale'
  | 'interpolate'
  | 'restyle'
  | 'inpaint'
  | 'remove_bg'
  | 'extend'
  | 'outpaint'
  | 'reframe'
  | 'retexture'
  | 'identity_lock'
  | 'relight'
  | 'pose'
  | 'publish'
  | 'workflow_step';

export type AssetOutputKind = 'image' | 'video' | 'audio' | '3d' | 'other';

export type RightsClass = 'fan' | 'original' | 'licensed';

export interface PromptRef {
  kind: 'image' | 'video' | 'identity' | 'moodboard' | 'style' | 'mask' | 'lora';
  url: string;
  assetId?: string;
  label?: string;
}

export interface AssetEvent {
  id: string;
  assetId: string;
  parentAssetId: string | null;
  rootAssetId: string;
  depth: number;

  kind: AssetEventKind;
  tool: string;
  step: AssetEventStep;

  prompt: string | null;
  promptRefs: PromptRef[];
  modelId: string | null;
  modelProvider: string | null;

  creditCost: number;
  latencyMs: number | null;

  creatorUid: string;
  creatorAddress: string | null;
  universeAddress: string | null;
  universeId: string | null;

  rightsClass: RightsClass | null;

  outputUrl: string | null;
  outputKind: AssetOutputKind;

  status: 'completed' | 'failed';

  createdAt: Date;
}

export interface RecordAssetEventInput {
  assetId: string;
  parentAssetId?: string | null;

  kind: AssetEventKind;
  tool: string;
  step: AssetEventStep;

  prompt?: string | null;
  promptRefs?: PromptRef[];
  modelId?: string | null;
  modelProvider?: string | null;

  creditCost?: number;
  latencyMs?: number | null;

  creatorUid: string;
  creatorAddress?: string | null;
  universeAddress?: string | null;
  universeId?: string | null;

  rightsClass?: RightsClass | null;

  outputUrl?: string | null;
  outputKind: AssetOutputKind;

  status?: 'completed' | 'failed';
}

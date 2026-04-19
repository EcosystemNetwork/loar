/**
 * Shared types + node-kind metadata for the workflow editor.
 * Mirrors the server-side `workflows.types.ts` schemas (kept in sync manually
 * since the server module isn't importable from the web app).
 */

export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export type WorkflowNodeKind = 'prompt' | 'ref' | 'animate' | 'upscale';

export interface PromptNodeParams {
  kind: 'prompt';
  text: string;
  negativePrompt?: string;
  seed?: number;
  aspectRatio: AspectRatio;
}

export interface RefNodeParams {
  kind: 'ref';
  assetUrl?: string;
  entityId?: string;
}

export interface AnimateNodeParams {
  kind: 'animate';
  durationSec: number;
  aspectRatio: AspectRatio;
  modelHint: 'fastest' | 'balanced' | 'highest_quality';
  motionPrompt?: string;
}

export interface UpscaleNodeParams {
  kind: 'upscale';
  factor: 2 | 4;
  prompt?: string;
}

export type AnyNodeParams =
  | PromptNodeParams
  | RefNodeParams
  | AnimateNodeParams
  | UpscaleNodeParams;

export const NODE_KIND_META: Record<
  WorkflowNodeKind,
  {
    label: string;
    description: string;
    accent: string;
    defaultParams: AnyNodeParams;
  }
> = {
  prompt: {
    label: 'Prompt',
    description: 'Generate an image from text (Imagen 4)',
    accent: 'violet',
    defaultParams: {
      kind: 'prompt',
      text: '',
      aspectRatio: '1:1',
    },
  },
  ref: {
    label: 'Reference',
    description: 'Use an existing image or entity portrait as input',
    accent: 'emerald',
    defaultParams: { kind: 'ref' },
  },
  animate: {
    label: 'Animate',
    description: 'Image → video (auto-routes through 14 video models)',
    accent: 'blue',
    defaultParams: {
      kind: 'animate',
      durationSec: 5,
      aspectRatio: '16:9',
      modelHint: 'balanced',
    },
  },
  upscale: {
    label: 'Upscale',
    description: 'Super-resolve an image (2× or 4×)',
    accent: 'amber',
    defaultParams: {
      kind: 'upscale',
      factor: 4,
    },
  },
};

export const NODE_IO: Record<WorkflowNodeKind, { inputs: string[]; outputs: string[] }> = {
  prompt: { inputs: [], outputs: ['imageUrl'] },
  ref: { inputs: [], outputs: ['imageUrl'] },
  animate: { inputs: ['imageUrl'], outputs: ['videoUrl'] },
  upscale: { inputs: ['imageUrl'], outputs: ['imageUrl'] },
};

import { PromptNode } from './PromptNode';
import { RefNode } from './RefNode';
import { AnimateNode } from './AnimateNode';
import { UpscaleNode } from './UpscaleNode';

export const workflowNodeTypes = {
  prompt: PromptNode,
  ref: RefNode,
  animate: AnimateNode,
  upscale: UpscaleNode,
} as const;

export * from './shared';
export { PromptNode, RefNode, AnimateNode, UpscaleNode };

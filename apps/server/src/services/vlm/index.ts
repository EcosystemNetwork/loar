/**
 * VLM (Vision-Language Model) subsystem.
 *
 * Turns generated + uploaded assets into structured canon:
 *   extractor       — video/image → scenes, entities, relationships, risks
 *   canon-checker   — compare extraction to universe bible
 *   moderation      — risk scoring → flags + content status
 *   copilot         — reference-aware prompt coaching + output scoring
 *   recap           — chapter/trailer/SEO generation
 *   governance      — draft canon proposals for voters
 *   search          — lexical (+ optional embedding) scene search
 *
 * See docs/prd-vlm-subsystem.md for the full spec.
 */

export * from './types';
export * from './schemas';
export * from './prompts';
export * from './gemini-client';
export { runExtraction } from './extractor';
export { runCanonCheck } from './canon-checker';
export { runModerationScoring } from './moderation';
export {
  improvePromptFromReferences,
  extractStyleBibleFromMoodboard,
  scoreOutput,
} from './copilot';
export { runRecap } from './recap';
export { runGovernanceDraft } from './governance';
export { searchScenes, indexScenesForContent } from './search';

// Phase 7 — feature-flagged continuous film + editing graph primitives
export {
  isAutoplayEnabled,
  autoplayConfig,
  readAutoplayState,
  canTickAutoplay,
  recordAutoplayRun,
} from './autoplay';
export {
  VLM_GRAPH_NODES,
  executeJudgeNode,
  type VlmGraphNodeDescriptor,
  type JudgeDecision,
} from './editing-graph';

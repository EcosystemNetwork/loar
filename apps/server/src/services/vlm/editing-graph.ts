/**
 * Editing-graph node primitives (Phase 7).
 *
 * The workflows router already has a visual DAG editor for generation
 * pipelines. Phase 7 adds VLM-native nodes so editors can:
 *
 *   - Planner    — turn an edit intent into a sub-graph of generation nodes
 *   - Judge      — score outputs from a generation node and decide to keep
 *                  the result, branch into a re-roll, or fail the pipeline
 *   - Continuity — compare the current render against a locked reference
 *                  bundle and reject when identity drifts
 *   - Stitcher   — concatenate scenes into an episode, applying chapter markers
 *
 * These node descriptors are surfaced via the workflows router so the frontend
 * DAG editor picks them up automatically. The actual execution lives in the
 * workflows worker.
 */

import type { CopilotScoreOutput } from './schemas';
import { scoreOutput } from './copilot';

export interface VlmGraphNodeDescriptor {
  id: string;
  label: string;
  description: string;
  inputs: Array<{ name: string; type: 'text' | 'url' | 'json' | 'number' | 'boolean' }>;
  outputs: Array<{ name: string; type: 'text' | 'url' | 'json' | 'number' | 'boolean' }>;
}

export const VLM_GRAPH_NODES: VlmGraphNodeDescriptor[] = [
  {
    id: 'vlm.planner',
    label: 'VLM Planner',
    description: 'Turn an edit intent (e.g. "make it moodier") into a downstream generation plan.',
    inputs: [
      { name: 'intent', type: 'text' },
      { name: 'sourceUrl', type: 'url' },
      { name: 'referenceUrls', type: 'json' },
    ],
    outputs: [{ name: 'plan', type: 'json' }],
  },
  {
    id: 'vlm.judge',
    label: 'VLM Judge',
    description:
      'Score a generated image/video against intent + references. Emits a decision (keep | reroll | reject).',
    inputs: [
      { name: 'outputUrl', type: 'url' },
      { name: 'outputType', type: 'text' },
      { name: 'intent', type: 'text' },
      { name: 'prompt', type: 'text' },
      { name: 'referenceUrls', type: 'json' },
      { name: 'keepThreshold', type: 'number' },
    ],
    outputs: [
      { name: 'score', type: 'json' },
      { name: 'decision', type: 'text' },
      { name: 'rerollPrompt', type: 'text' },
    ],
  },
  {
    id: 'vlm.continuity',
    label: 'Continuity Lock',
    description: 'Reject renders where identity strength drops below a per-slot threshold.',
    inputs: [
      { name: 'outputUrl', type: 'url' },
      { name: 'referenceBundle', type: 'json' },
      { name: 'identityThreshold', type: 'number' },
    ],
    outputs: [
      { name: 'passed', type: 'boolean' },
      { name: 'details', type: 'json' },
    ],
  },
  {
    id: 'vlm.stitcher',
    label: 'Episode Stitcher',
    description:
      'Concatenate scene outputs into an episode, applying chapter markers from an extraction.',
    inputs: [
      { name: 'sceneUrls', type: 'json' },
      { name: 'chapterMarkers', type: 'json' },
    ],
    outputs: [
      { name: 'episodeUrl', type: 'url' },
      { name: 'manifest', type: 'json' },
    ],
  },
];

export type JudgeDecision = 'keep' | 'reroll' | 'reject';

export async function executeJudgeNode(input: {
  outputUrl: string;
  outputType: 'image' | 'video';
  intent: string;
  prompt: string;
  referenceUrls: string[];
  keepThreshold?: number;
}): Promise<{
  score: CopilotScoreOutput;
  decision: JudgeDecision;
  rerollPrompt: string;
}> {
  const { score } = await scoreOutput({
    outputUrl: input.outputUrl,
    outputType: input.outputType,
    intent: input.intent,
    prompt: input.prompt,
    referenceUrls: input.referenceUrls,
  });
  const threshold = input.keepThreshold ?? 0.65;
  const composite =
    (score.matchesIntent + score.identityPreserved + score.compositionMatch + score.styleMatch) / 4;
  let decision: JudgeDecision;
  if (composite >= threshold) decision = 'keep';
  else if (composite >= threshold - 0.2 && score.rerollPrompt) decision = 'reroll';
  else decision = 'reject';
  return { score, decision, rerollPrompt: score.rerollPrompt };
}

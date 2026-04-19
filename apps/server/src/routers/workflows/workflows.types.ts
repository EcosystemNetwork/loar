/**
 * Workflow types + Zod schemas — PRD 9 Phase 1.
 *
 * A Workflow is a user-authored DAG of generation primitives. Nodes/edges
 * mirror React Flow's persistable shape so the frontend can round-trip the
 * graph without translation. Node kinds for Phase 1: prompt, ref, animate,
 * upscale. Mask/style/relight/outpaint/control land in Phase 3.
 */
import { z } from 'zod';

// ── Constants ──────────────────────────────────────────────────────────

export const WORKFLOW_NODE_KINDS = ['prompt', 'ref', 'animate', 'upscale'] as const;
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];

export const WORKFLOW_VISIBILITIES = ['private', 'collaborator', 'paid', 'canon'] as const;
export type WorkflowVisibility = (typeof WORKFLOW_VISIBILITIES)[number];

export const WORKFLOW_STATUSES = ['draft', 'active', 'archived'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const CONTENT_STATUSES = [
  'active',
  'flagged',
  'under_review',
  'hidden',
  'removed',
  'reinstated',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Phase 1 hard limits */
export const WORKFLOW_LIMITS = {
  MAX_NODES: 25,
  MAX_EDGES: 75,
  MAX_NAME_LEN: 120,
  MAX_DESCRIPTION_LEN: 2000,
  MAX_COLLABORATORS: 50,
} as const;

// ── Aspect ratio (shared across prompt/animate) ───────────────────────

export const aspectRatioSchema = z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

// ── Per-kind node data schemas ────────────────────────────────────────

export const promptNodeParamsSchema = z.object({
  kind: z.literal('prompt'),
  text: z.string().min(1).max(4000),
  negativePrompt: z.string().max(1000).optional(),
  seed: z.number().int().optional(),
  aspectRatio: aspectRatioSchema.default('1:1'),
});
export type PromptNodeParams = z.infer<typeof promptNodeParamsSchema>;

export const refNodeParamsSchema = z
  .object({
    kind: z.literal('ref'),
    /** Either a pre-existing asset URL or an entityId to resolve at run-time. */
    assetUrl: z.string().url().optional(),
    entityId: z.string().min(1).optional(),
  })
  .refine((v) => !!v.assetUrl || !!v.entityId, {
    message: 'ref node requires either assetUrl or entityId',
  });
export type RefNodeParams = z.infer<typeof refNodeParamsSchema>;

export const animateNodeParamsSchema = z.object({
  kind: z.literal('animate'),
  durationSec: z.number().min(2).max(10).default(5),
  aspectRatio: aspectRatioSchema.default('16:9'),
  modelHint: z.enum(['fastest', 'balanced', 'highest_quality']).default('balanced'),
  /** Optional text prompt to guide the motion. Falls back to upstream prompt text. */
  motionPrompt: z.string().max(2000).optional(),
});
export type AnimateNodeParams = z.infer<typeof animateNodeParamsSchema>;

export const upscaleNodeParamsSchema = z.object({
  kind: z.literal('upscale'),
  factor: z.union([z.literal(2), z.literal(4)]).default(4),
  /** Optional guidance prompt for the creative upscaler. */
  prompt: z.string().max(1000).optional(),
});
export type UpscaleNodeParams = z.infer<typeof upscaleNodeParamsSchema>;

export const nodeParamsSchema = z.discriminatedUnion('kind', [
  promptNodeParamsSchema,
  refNodeParamsSchema,
  animateNodeParamsSchema,
  upscaleNodeParamsSchema,
]);
export type NodeParams = z.infer<typeof nodeParamsSchema>;

// ── Graph shape (matches React Flow persistable node/edge) ────────────

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  /** React Flow's node "type" string — matches `WorkflowNodeKind`. */
  type: z.enum(WORKFLOW_NODE_KINDS),
  position: z.object({ x: z.number(), y: z.number() }),
  data: nodeParamsSchema,
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const workflowGraphSchema = z.object({
  nodes: z.array(graphNodeSchema).max(WORKFLOW_LIMITS.MAX_NODES),
  edges: z.array(graphEdgeSchema).max(WORKFLOW_LIMITS.MAX_EDGES),
});
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

// ── Workflow doc ──────────────────────────────────────────────────────

export interface Workflow {
  id: string;
  ownerUid: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
  version: number;
  visibility: WorkflowVisibility;
  priceCredits: number;
  universeAddress: string | null;
  status: WorkflowStatus;
  contentStatus: ContentStatus;
  collaboratorUids: string[];
  forkedFrom: string | null;
  createdAt: number;
  updatedAt: number;
}

// ── Workflow run / NodeRun ────────────────────────────────────────────

export interface NodeRun {
  id: string;
  nodeId: string;
  kind: WorkflowNodeKind;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  modelUsed: string | null;
  providerCostUsd: number;
  creditsCharged: number;
  durationMs: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  ownerUid: string;
  graphSnapshot: WorkflowGraph;
  nodeRuns: NodeRun[];
  status: WorkflowRunStatus;
  totalCostCredits: number;
  /** Run-time overrides keyed by nodeId → partial params patch. */
  inputs: Record<string, Record<string, unknown>>;
  /** Keyed by terminal nodeId → that node's output object. */
  outputs: Record<string, Record<string, unknown>>;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

// ── Input schemas for tRPC procedures ─────────────────────────────────

export const createWorkflowInputSchema = z.object({
  name: z.string().min(1).max(WORKFLOW_LIMITS.MAX_NAME_LEN),
  description: z.string().max(WORKFLOW_LIMITS.MAX_DESCRIPTION_LEN).default(''),
  graph: workflowGraphSchema.default({ nodes: [], edges: [] }),
  universeAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .nullish(),
});

export const updateWorkflowInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(WORKFLOW_LIMITS.MAX_NAME_LEN).optional(),
  description: z.string().max(WORKFLOW_LIMITS.MAX_DESCRIPTION_LEN).optional(),
  graph: workflowGraphSchema.optional(),
  visibility: z.enum(WORKFLOW_VISIBILITIES).optional(),
  collaboratorUids: z.array(z.string().min(1)).max(WORKFLOW_LIMITS.MAX_COLLABORATORS).optional(),
  priceCredits: z.number().int().nonnegative().optional(),
  universeAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .nullish()
    .optional(),
});

export const forkWorkflowInputSchema = z.object({ id: z.string().min(1) });

export const runOverridesSchema = z.record(z.string(), z.record(z.string(), z.any())).default({});

export const runWorkflowInputSchema = z.object({
  id: z.string().min(1),
  overrides: runOverridesSchema,
});

export const estimateCostInputSchema = z.union([
  z.object({ id: z.string().min(1) }),
  z.object({ graph: workflowGraphSchema }),
]);

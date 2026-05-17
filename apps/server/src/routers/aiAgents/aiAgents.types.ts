/**
 * AI Agent Types — Schemas and interfaces for the AI agent system
 */
import { z } from 'zod';

// ── Agent types and permissions ────────────────────────────────────────

export const AI_AGENT_TYPES = [
  'content_creator',
  'universe_manager',
  'moderator',
  'universe_representative',
] as const;
export type AIAgentType = (typeof AI_AGENT_TYPES)[number];

export const AI_AGENT_PERMISSIONS = [
  'create_entities',
  'generate_assets',
  'submit_canon',
  'manage_storylines',
  'negotiate_collabs',
  'moderate',
] as const;
export type AIAgentPermission = (typeof AI_AGENT_PERMISSIONS)[number];

// Maps permissions to the tRPC actions they allow
export const PERMISSION_ACTION_MAP: Record<AIAgentPermission, string[]> = {
  create_entities: ['entities.create', 'entities.update'],
  generate_assets: [
    'studio.createEntityPack',
    'image.generate',
    'generation.generate',
    'voice.generate',
    'threed.generate',
  ],
  submit_canon: ['marketplace.submit'],
  manage_storylines: ['entities.create', 'content.create', 'wiki.generate'],
  negotiate_collabs: ['collabs.propose'],
  moderate: ['content.flag', 'content.updateStatus'],
};

// ── Schemas ────────────────────────────────────────────────────────────

export const createAIAgentSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(AI_AGENT_TYPES),
  description: z.string().max(1000).default(''),
  avatarUrl: z.string().url().optional(),
  universeId: z.string().optional(),
  permissions: z.array(z.enum(AI_AGENT_PERMISSIONS)).min(1),
  creditBudgetPeriod: z.enum(['monthly', 'total']).default('total'),
  /** When true, generation/image steps bill against the agent owner's BYOK
   *  API keys instead of platform credits. The agent owner's wallet still
   *  pays for any on-chain operations regardless. */
  useBYOK: z.boolean().default(false),
});

export const updateAIAgentSchema = z.object({
  agentId: z.string(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  avatarUrl: z.string().url().optional(),
  permissions: z.array(z.enum(AI_AGENT_PERMISSIONS)).min(1).optional(),
  creditBudgetPeriod: z.enum(['monthly', 'total']).optional(),
  useBYOK: z.boolean().optional(),
});

// ── Document interfaces ────────────────────────────────────────────────

export interface AIAgentDoc {
  id: string;
  name: string;
  type: AIAgentType;
  description: string;
  avatarUrl: string | null;
  createdByUid: string;
  universeId: string | null;
  permissions: AIAgentPermission[];
  creditBudgetTotal: number;
  creditBudgetSpent: number;
  creditBudgetPeriod: 'monthly' | 'total';
  creditSourceUid: string;
  creditSourceType: 'personal' | 'universe_pool';
  status: 'active' | 'paused' | 'disabled';
  useBYOK: boolean;
  lastRunAt: Date | null;
  totalRunCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ── Pipeline types ─────────────────────────────────────────────────────

export const pipelineStepSchema = z.object({
  stepId: z.string().min(1),
  action: z.string().min(1), // e.g. "entities.create", "studio.createEntityPack"
  inputMapping: z.record(z.string(), z.string()).default({}), // maps outputs from previous steps
  config: z.record(z.string(), z.unknown()).default({}), // static config for this step
  onFailure: z.enum(['skip', 'abort', 'retry']).default('abort'),
  retryCount: z.number().min(0).max(3).default(0),
});

export type PipelineStep = z.infer<typeof pipelineStepSchema>;

export const createPipelineSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  aiAgentId: z.string(),
  steps: z.array(pipelineStepSchema).min(1).max(20),
  triggerType: z.enum(['manual', 'schedule', 'event']).default('manual'),
  triggerConfig: z
    .object({
      cron: z.string().optional(),
      eventType: z.string().optional(),
      eventFilter: z.record(z.string(), z.string()).optional(),
    })
    .default({}),
});

export const updatePipelineSchema = z.object({
  pipelineId: z.string(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  steps: z.array(pipelineStepSchema).min(1).max(20).optional(),
  triggerType: z.enum(['manual', 'schedule', 'event']).optional(),
  triggerConfig: z
    .object({
      cron: z.string().optional(),
      eventType: z.string().optional(),
      eventFilter: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  status: z.enum(['active', 'paused', 'draft']).optional(),
});

export interface PipelineDoc {
  id: string;
  name: string;
  description: string;
  aiAgentId: string;
  createdByUid: string;
  steps: PipelineStep[];
  triggerType: 'manual' | 'schedule' | 'event';
  triggerConfig: {
    cron?: string;
    eventType?: string;
    eventFilter?: Record<string, string>;
  };
  status: 'active' | 'paused' | 'draft';
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineRunStep {
  stepId: string;
  action: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  creditsUsed: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export interface PipelineRunDoc {
  id: string;
  pipelineId: string;
  aiAgentId: string;
  triggeredBy: 'manual' | 'schedule' | 'event';
  status: 'running' | 'completed' | 'partial' | 'failed';
  steps: PipelineRunStep[];
  totalCreditsUsed: number;
  startedAt: Date;
  completedAt: Date | null;
}

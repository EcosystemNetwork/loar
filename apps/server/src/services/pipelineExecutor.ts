/**
 * Pipeline Executor Service
 *
 * Executes AI agent pipelines step-by-step, mapping outputs between steps,
 * checking permissions, and managing credit budgets.
 *
 * Each pipeline step maps to an internal handler function from the existing
 * router system (entities, studio, generation, marketplace, etc.)
 */
import { db } from '../lib/firebase';
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';
import {
  PERMISSION_ACTION_MAP,
  type AIAgentPermission,
  type PipelineStep,
  type PipelineRunStep,
} from '../routers/aiAgents/aiAgents.types';
import { deductAgentCredits, refundAgentCredits } from './aiAgentCredits';

// ── Types ──────────────────────────────────────────────────────────────

interface AgentContext {
  agentId: string;
  createdByUid: string;
  universeId: string | null;
  permissions: AIAgentPermission[];
}

interface StepResult {
  output: Record<string, unknown>;
  creditsUsed: number;
}

// ── Action Registry ────────────────────────────────────────────────────
// Maps pipeline action strings to internal handler functions.
// Each action receives merged input (static config + mapped outputs from prior steps)
// and the agent context. Returns an output object.

type ActionHandler = (input: Record<string, unknown>, ctx: AgentContext) => Promise<StepResult>;

const ACTION_REGISTRY: Record<string, ActionHandler> = {
  'entities.create': async (input, ctx) => {
    const entitiesCol = db.collection('entities');
    const entity = {
      name: input.name as string,
      description: (input.description as string) || '',
      kind: (input.kind as string) || 'thing',
      universeAddress: ctx.universeId,
      parentId: (input.parentId as string) || null,
      nodeIds: [],
      imageUrl: (input.imageUrl as string) || null,
      metadata: (input.metadata as Record<string, unknown>) || {},
      creator: ctx.createdByUid,
      monetized: false,
      rightsDeclaration: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await entitiesCol.add(entity);
    return { output: { id: ref.id, ...entity }, creditsUsed: 0 };
  },

  'entities.update': async (input, ctx) => {
    const entityId = input.entityId as string;
    if (!entityId) throw new Error('entityId required');

    // Whitelist allowed fields to prevent privilege escalation
    const ALLOWED_FIELDS = ['name', 'description', 'parentId', 'imageUrl', 'metadata', 'kind'];
    const updates: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (input[field] !== undefined) {
        updates[field] = input[field];
      }
    }

    const ref = db.collection('entities').doc(entityId);
    const existing = (await ref.get()).data();
    if (!existing) throw new Error('Entity not found');
    if (existing.creator !== ctx.createdByUid) {
      throw new Error('Agent can only update entities created by its owner');
    }

    await ref.update({ ...updates, updatedAt: new Date() });

    return { output: { id: entityId, updated: true }, creditsUsed: 0 };
  },

  'studio.createEntityPack': async (input, ctx) => {
    // Create a studio job record — the actual generation is handled by the studio service
    const studioJobsCol = db.collection('studioJobs');
    const job = {
      entityId: input.entityId as string,
      entityKind: (input.entityKind as string) || 'thing',
      capabilities: (input.capabilities as string[]) || ['portrait', 'lore_card'],
      overrides: (input.overrides as Record<string, unknown>) || {},
      userId: ctx.createdByUid,
      aiAgentId: ctx.agentId,
      status: 'queued',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await studioJobsCol.add(job);
    // Estimate ~10 credits per capability
    const estimatedCredits = (job.capabilities.length || 1) * 10;
    return { output: { jobId: ref.id, ...job }, creditsUsed: estimatedCredits };
  },

  'generation.generate': async (input, ctx) => {
    // Create a generation record — uses existing generation infrastructure
    const generationsCol = db.collection('videoGenerations');
    const gen = {
      prompt: input.prompt as string,
      mode: (input.mode as string) || 'text_to_video',
      durationSec: (input.durationSec as number) || 5,
      routingMode: 'auto',
      userId: ctx.createdByUid,
      aiAgentId: ctx.agentId,
      universeId: ctx.universeId,
      status: 'queued',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await generationsCol.add(gen);
    return { output: { generationId: ref.id, ...gen }, creditsUsed: 15 };
  },

  'image.generate': async (input, ctx) => {
    const generationsCol = db.collection('imageGenerations');
    const gen = {
      prompt: input.prompt as string,
      count: (input.count as number) || 1,
      aspectRatio: (input.aspectRatio as string) || 'square_hd',
      userId: ctx.createdByUid,
      aiAgentId: ctx.agentId,
      universeId: ctx.universeId,
      status: 'queued',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await generationsCol.add(gen);
    return { output: { generationId: ref.id, ...gen }, creditsUsed: 5 };
  },

  'marketplace.submit': async (input, ctx) => {
    const submissionsCol = db.collection('canonSubmissions');
    const submission = {
      universeId: ctx.universeId || (input.universeId as string),
      universeToken: (input.universeToken as string) || '',
      submissionType: (input.submissionType as string) || 'LORE_RULE',
      title: input.title as string,
      description: input.description as string,
      contentHash: (input.contentHash as string) || '',
      metadataURI: (input.metadataURI as string) || '',
      creatorUid: ctx.createdByUid,
      creatorAddress: null,
      aiAgentId: ctx.agentId,
      status: 'VOTING',
      votesFor: 0,
      votesAgainst: 0,
      voterCount: 0,
      votingDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await submissionsCol.add(submission);
    return { output: { submissionId: ref.id, ...submission }, creditsUsed: 0 };
  },

  'collabs.propose': async (input, ctx) => {
    const collabsCol = db.collection('collabs');
    const collab = {
      universeA: ctx.universeId || (input.universeA as string),
      universeB: input.universeB as string,
      revenueShareBps: (input.revenueShareBps as number) || 5000,
      durationDays: (input.durationDays as number) || 90,
      title: input.title as string,
      description: (input.description as string) || '',
      proposerUid: ctx.createdByUid,
      proposerAddress: null,
      acceptorUid: null,
      acceptorAddress: null,
      status: 'PROPOSED',
      totalRevenue: '0',
      episodeCount: 0,
      startTime: null,
      endTime: null,
      aiAgentId: ctx.agentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await collabsCol.add(collab);
    return { output: { collabId: ref.id, ...collab }, creditsUsed: 0 };
  },

  'content.create': async (input, ctx) => {
    const contentCol = db.collection('content');
    const content = {
      title: input.title as string,
      body: (input.body as string) || '',
      contentType: (input.contentType as string) || 'text',
      universeId: ctx.universeId,
      creatorUid: ctx.createdByUid,
      aiAgentId: ctx.agentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await contentCol.add(content);
    return { output: { contentId: ref.id, ...content }, creditsUsed: 0 };
  },

  'wiki.generate': async (input, ctx) => {
    // Creates a lore/wiki entry for an entity
    const entitiesCol = db.collection('entities');
    const entity = {
      name: input.name as string,
      description: (input.description as string) || '',
      kind: 'lore',
      universeAddress: ctx.universeId,
      parentId: (input.parentId as string) || null,
      nodeIds: [],
      imageUrl: null,
      metadata: {
        loreType: (input.loreType as string) || 'general',
        ...((input.metadata as Record<string, unknown>) || {}),
      },
      creator: ctx.createdByUid,
      monetized: false,
      rightsDeclaration: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await entitiesCol.add(entity);
    return { output: { entityId: ref.id, ...entity }, creditsUsed: 0 };
  },
};

// ── Input Mapping ──────────────────────────────────────────────────────

/**
 * Resolves input values from previous step outputs using dot notation.
 * e.g., "step_1.output.id" resolves to stepOutputs["step_1"].id
 */
function resolveInputMapping(
  mapping: Record<string, string>,
  stepOutputs: Record<string, Record<string, unknown>>,
  staticConfig: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...staticConfig };

  for (const [key, path] of Object.entries(mapping)) {
    const parts = path.split('.');
    if (parts.length < 2) {
      resolved[key] = path; // literal value
      continue;
    }

    const [stepId, ...rest] = parts;
    let value: unknown = stepOutputs[stepId];
    for (const part of rest) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }
    resolved[key] = value;
  }

  return resolved;
}

// ── Permission Check ───────────────────────────────────────────────────

function checkPermission(action: string, permissions: AIAgentPermission[]): boolean {
  for (const perm of permissions) {
    const allowed = PERMISSION_ACTION_MAP[perm];
    if (allowed?.includes(action)) return true;
  }
  return false;
}

// ── Pipeline Executor ──────────────────────────────────────────────────

const pipelineRunsCol = () => db.collection('aiAgentPipelineRuns');
const aiAgentsCol = () => db.collection('aiAgents');

/**
 * Execute a pipeline. Called as fire-and-forget from the aiPipelines router.
 * Updates the run document in real-time as steps complete.
 */
export async function executePipeline(
  runId: string,
  steps: PipelineStep[],
  agentContext: AgentContext
): Promise<void> {
  const runRef = pipelineRunsCol().doc(runId);
  const stepOutputs: Record<string, Record<string, unknown>> = {};
  let totalCreditsUsed = 0;
  let allSucceeded = true;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Check permission
    if (!checkPermission(step.action, agentContext.permissions)) {
      const runStep: PipelineRunStep = {
        stepId: step.stepId,
        action: step.action,
        status: 'failed',
        input: {},
        output: null,
        creditsUsed: 0,
        startedAt: new Date(),
        completedAt: new Date(),
        error: `Agent lacks permission for action: ${step.action}`,
      };

      await updateRunStep(runRef, i, runStep);

      if (step.onFailure === 'abort') {
        allSucceeded = false;
        await runRef.update({ status: 'failed', completedAt: new Date(), totalCreditsUsed });
        return;
      }
      continue;
    }

    // Resolve inputs
    const input = resolveInputMapping(step.inputMapping, stepOutputs, step.config);

    // Mark step as running
    await updateRunStep(runRef, i, {
      stepId: step.stepId,
      action: step.action,
      status: 'running',
      input,
      output: null,
      creditsUsed: 0,
      startedAt: new Date(),
      completedAt: null,
      error: null,
    });

    // Execute with retry
    let lastError: string | null = null;
    let result: StepResult | null = null;
    const maxAttempts = 1 + (step.retryCount || 0);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const handler = ACTION_REGISTRY[step.action];
        if (!handler) {
          throw new Error(`Unknown action: ${step.action}`);
        }

        result = await handler(input, agentContext);

        // Deduct credits if this step costs anything
        if (result.creditsUsed > 0) {
          await deductAgentCredits(agentContext.agentId, result.creditsUsed);
        }

        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts - 1) {
          // Wait before retry (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    if (lastError || !result) {
      // Step failed
      const runStep: PipelineRunStep = {
        stepId: step.stepId,
        action: step.action,
        status: 'failed',
        input,
        output: null,
        creditsUsed: 0,
        startedAt: new Date(),
        completedAt: new Date(),
        error: lastError || 'Unknown error',
      };
      await updateRunStep(runRef, i, runStep);

      if (step.onFailure === 'abort') {
        allSucceeded = false;
        await runRef.update({ status: 'failed', completedAt: new Date(), totalCreditsUsed });
        return;
      } else if (step.onFailure === 'skip') {
        allSucceeded = false;
        continue;
      }
    } else {
      // Step succeeded
      stepOutputs[step.stepId] = result.output;
      totalCreditsUsed += result.creditsUsed;

      const runStep: PipelineRunStep = {
        stepId: step.stepId,
        action: step.action,
        status: 'completed',
        input,
        output: result.output,
        creditsUsed: result.creditsUsed,
        startedAt: new Date(),
        completedAt: new Date(),
        error: null,
      };
      await updateRunStep(runRef, i, runStep);
    }
  }

  // Update agent stats atomically to prevent race conditions
  await aiAgentsCol()
    .doc(agentContext.agentId)
    .update({
      lastRunAt: new Date(),
      totalRunCount: FieldValue.increment(1),
      creditBudgetSpent: FieldValue.increment(totalCreditsUsed),
      updatedAt: new Date(),
    });

  // Finalize run
  await runRef.update({
    status: allSucceeded ? 'completed' : 'partial',
    completedAt: new Date(),
    totalCreditsUsed,
  });
}

/** Update a single step in the run document */
async function updateRunStep(
  runRef: FirebaseFirestore.DocumentReference,
  stepIndex: number,
  step: PipelineRunStep
): Promise<void> {
  const doc = await runRef.get();
  if (!doc.exists) return;

  const steps = doc.data()?.steps || [];
  steps[stepIndex] = step;

  await runRef.update({ steps });
}

/**
 * AI Pipelines Router — Define and execute multi-step AI agent workflows
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import {
  createPipelineSchema,
  updatePipelineSchema,
  type AIAgentPermission,
  type PipelineRunStep,
} from '../aiAgents/aiAgents.types';
import { executePipeline } from '../../services/pipelineExecutor';
import { emitActivity } from '../../services/activity';

const pipelinesCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('aiAgentPipelines');
};
const pipelineRunsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('aiAgentPipelineRuns');
};
const aiAgentsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('aiAgents');
};

export const aiPipelinesRouter = router({
  // ── CRUD ─────────────────────────────────────────────────────────────

  create: protectedProcedure.input(createPipelineSchema).mutation(async ({ input, ctx }) => {
    // Verify agent exists and caller owns it
    const agentDoc = await aiAgentsCol().doc(input.aiAgentId).get();
    if (!agentDoc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'AI agent not found' });
    if (agentDoc.data()?.createdByUid !== ctx.user.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the agent owner' });
    }

    const pipelineId = randomUUID();
    const pipeline = {
      id: pipelineId,
      name: input.name,
      description: input.description || '',
      aiAgentId: input.aiAgentId,
      createdByUid: ctx.user.uid,
      steps: input.steps,
      triggerType: input.triggerType,
      triggerConfig: input.triggerConfig,
      status: 'draft' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await pipelinesCol().doc(pipelineId).set(pipeline);
    return pipeline;
  }),

  update: protectedProcedure.input(updatePipelineSchema).mutation(async ({ input, ctx }) => {
    const ref = pipelinesCol().doc(input.pipelineId);
    const doc = await ref.get();
    if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pipeline not found' });
    if (doc.data()?.createdByUid !== ctx.user.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the pipeline owner' });
    }

    const { pipelineId, ...updates } = input;
    await ref.update({ ...updates, updatedAt: new Date() });
    return { ok: true };
  }),

  delete: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = pipelinesCol().doc(input.pipelineId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pipeline not found' });
      if (doc.data()?.createdByUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the pipeline owner' });
      }

      await ref.delete();
      return { ok: true };
    }),

  // ── Queries ──────────────────────────────────────────────────────────

  get: publicProcedure.input(z.object({ pipelineId: z.string() })).query(async ({ input }) => {
    const doc = await pipelinesCol().doc(input.pipelineId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }),

  listByAgent: publicProcedure
    .input(z.object({ aiAgentId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await pipelinesCol()
        .where('aiAgentId', '==', input.aiAgentId)
        .orderBy('createdAt', 'desc')
        .get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  // ── Execution ────────────────────────────────────────────────────────

  run: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        overrides: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const pipelineDoc = await pipelinesCol().doc(input.pipelineId).get();
      if (!pipelineDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Pipeline not found' });
      if (pipelineDoc.data()?.createdByUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the pipeline owner' });
      }

      const pipeline = pipelineDoc.data()!;

      // Get the agent
      const agentDoc = await aiAgentsCol().doc(pipeline.aiAgentId).get();
      if (!agentDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'AI agent not found' });
      const agent = agentDoc.data()!;

      if (agent.status !== 'active') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Agent is ${agent.status}, not active`,
        });
      }

      // Create run document
      const runId = randomUUID();
      const initialSteps: PipelineRunStep[] = pipeline.steps.map((s: any) => ({
        stepId: s.stepId,
        action: s.action,
        status: 'pending' as const,
        input: {},
        output: null,
        creditsUsed: 0,
        startedAt: null,
        completedAt: null,
        error: null,
      }));

      const run = {
        id: runId,
        pipelineId: input.pipelineId,
        aiAgentId: pipeline.aiAgentId,
        triggeredBy: 'manual' as const,
        status: 'running' as const,
        steps: initialSteps,
        totalCreditsUsed: 0,
        startedAt: new Date(),
        completedAt: null,
      };

      await pipelineRunsCol().doc(runId).set(run);

      // Apply overrides to step configs (filter dangerous keys to prevent prototype pollution)
      let steps = pipeline.steps;
      if (input.overrides) {
        const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
        const safeOverrides = Object.fromEntries(
          Object.entries(input.overrides).filter(([k]) => !DANGEROUS_KEYS.has(k))
        );
        steps = steps.map((s: any) => ({
          ...s,
          config: { ...s.config, ...safeOverrides },
        }));
      }

      // Execute pipeline in background (fire-and-forget)
      const agentContext = {
        agentId: pipeline.aiAgentId,
        createdByUid: agent.createdByUid,
        universeId: agent.universeId || null,
        permissions: agent.permissions as AIAgentPermission[],
      };

      executePipeline(runId, steps, agentContext).catch((err) => {
        console.error(`Pipeline run ${runId} failed:`, err);
        pipelineRunsCol()
          .doc(runId)
          .update({
            status: 'failed',
            completedAt: new Date(),
          })
          .catch(() => {});
      });

      emitActivity({
        actorUid: ctx.user.uid,
        eventType: 'ai_pipeline_completed' as any,
        targetType: 'pipelineRun',
        targetId: runId,
        metadata: { pipelineName: pipeline.name, agentName: agent.name },
      }).catch(() => {});

      return { runId, status: 'running' };
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input, ctx }) => {
      const doc = await pipelineRunsCol().doc(input.runId).get();
      if (!doc.exists) return null;
      const data = doc.data();
      // Ownership: match against the pipeline's creator via the agent
      const pipelineDoc = data?.pipelineId ? await pipelinesCol().doc(data.pipelineId).get() : null;
      const pipelineOwner = pipelineDoc?.data()?.createdByUid;
      if (pipelineOwner !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your pipeline run' });
      }
      return { id: doc.id, ...data };
    }),

  listRuns: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify caller owns the pipeline before listing its runs
      const pipelineDoc = await pipelinesCol().doc(input.pipelineId).get();
      if (!pipelineDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Pipeline not found' });
      }
      if (pipelineDoc.data()?.createdByUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the pipeline owner' });
      }

      const snapshot = await pipelineRunsCol()
        .where('pipelineId', '==', input.pipelineId)
        .orderBy('startedAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),
});

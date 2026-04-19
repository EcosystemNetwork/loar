/**
 * Workflows tRPC router — PRD 9 Phase 1.
 *
 * All procedures are protectedProcedure. Visibility-checked reads use
 * `getWorkflowFor` which throws FORBIDDEN for non-viewers. The `run`
 * procedure kicks off async execution and returns `{ runId }` — the
 * frontend polls `getRun` for progress.
 */
import { z } from 'zod';
import { router, protectedProcedure, requirePermission } from '../../lib/trpc';
import {
  archiveWorkflow,
  createWorkflow,
  estimateCost,
  forkWorkflow,
  getRun,
  getWorkflowFor,
  listRuns,
  listWorkflowsByOwner,
  listWorkflowsByUniverse,
  updateWorkflow,
} from './workflows.handlers';
import { cancelRun, sweepOrphanedRuns, startWorkflowRun } from './workflows.executor';
import {
  createWorkflowInputSchema,
  estimateCostInputSchema,
  forkWorkflowInputSchema,
  runWorkflowInputSchema,
  updateWorkflowInputSchema,
  workflowGraphSchema,
} from './workflows.types';

// Sweep stuck runs once on first router import (server start).
sweepOrphanedRuns().catch((err) => console.error('[workflows] startup sweep failed:', err));

const ethereumAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

export const workflowsRouter = router({
  /** List the calling user's workflows. */
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().int().positive().max(200).default(100) }).default({ limit: 100 })
    )
    .query(async ({ ctx, input }) => {
      const workflows = await listWorkflowsByOwner(ctx.user.uid, input.limit);
      return { workflows, total: workflows.length };
    }),

  /** List workflows attached to a universe (owner-agnostic, visibility-checked). */
  listByUniverse: protectedProcedure
    .input(
      z.object({
        universeAddress: ethereumAddress,
        limit: z.number().int().positive().max(200).default(100),
      })
    )
    .query(async ({ input }) => {
      const workflows = await listWorkflowsByUniverse(
        input.universeAddress.toLowerCase(),
        input.limit
      );
      return { workflows, total: workflows.length };
    }),

  /** Fetch one workflow (visibility-checked). */
  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const workflow = await getWorkflowFor(input.id, ctx.user.uid);
      return workflow;
    }),

  /** Create a new draft workflow. */
  create: protectedProcedure
    .use(requirePermission('workflows.create'))
    .input(createWorkflowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const workflow = await createWorkflow(
        {
          name: input.name,
          description: input.description,
          graph: input.graph,
          universeAddress: input.universeAddress ?? null,
        },
        ctx.user.uid
      );
      return { workflow };
    }),

  /** Update name, description, graph, visibility, collaborators, or price. */
  update: protectedProcedure
    .use(requirePermission('workflows.update'))
    .input(updateWorkflowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const workflow = await updateWorkflow(id, patch, ctx.user.uid);
      return { workflow };
    }),

  /** Fork a workflow into a new private draft owned by the caller. */
  fork: protectedProcedure
    .use(requirePermission('workflows.create'))
    .input(forkWorkflowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const workflow = await forkWorkflow(input.id, ctx.user.uid);
      return { workflow };
    }),

  /** Soft-delete (archive). */
  archive: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await archiveWorkflow(input.id, ctx.user.uid);
      return { success: true };
    }),

  /** Pre-flight cost estimate for a saved or in-flight graph. */
  estimateCost: protectedProcedure.input(estimateCostInputSchema).query(async ({ ctx, input }) => {
    const graph =
      'id' in input ? (await getWorkflowFor(input.id, ctx.user.uid)).graph : input.graph;
    return estimateCost(graph);
  }),

  /** Validate a graph (cycle/handles/limits) without persisting. */
  validateGraph: protectedProcedure
    .input(z.object({ graph: workflowGraphSchema }))
    .query(async ({ input }) => {
      const { validateGraph } = await import('./workflows.handlers');
      validateGraph(input.graph);
      return { valid: true as const };
    }),

  /** Kick off a run — returns runId immediately, executor runs async. */
  run: protectedProcedure
    .use(requirePermission('workflows.run'))
    .input(runWorkflowInputSchema)
    .mutation(async ({ ctx, input }) => {
      return startWorkflowRun({
        workflowId: input.id,
        ownerUid: ctx.user.uid,
        overrides: input.overrides,
      });
    }),

  /** Fetch a single run (owner-only). */
  getRun: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return getRun(input.runId, ctx.user.uid);
    }),

  /** List runs for one workflow (owner-only). */
  listRuns: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().min(1),
        limit: z.number().int().positive().max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const runs = await listRuns(input.workflowId, ctx.user.uid, input.limit);
      return { runs, total: runs.length };
    }),

  /** Cancel an in-flight run (owner-only). */
  cancelRun: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await cancelRun(input.runId, ctx.user.uid);
      return { success: true };
    }),
});

export type WorkflowsRouter = typeof workflowsRouter;

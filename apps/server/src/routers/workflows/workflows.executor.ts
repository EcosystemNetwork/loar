/**
 * Workflow DAG executor.
 *
 * `executeWorkflow` is a fire-and-forget orchestrator. The tRPC `run`
 * procedure creates the run doc, kicks this off without awaiting, and
 * returns the runId. The orchestrator updates the run doc as nodes
 * complete.
 *
 * Phase 1 design notes:
 *  - Each topological layer runs in parallel (cap = MAX_PARALLEL_NODES)
 *  - Nodes write immutable NodeRun records into the run's nodeRuns[] via arrayUnion
 *  - Cancellation = AbortController in `runAbortRegistry`; node executors check
 *    `signal.throwIfAborted()` between awaits
 *  - On any failure: outstanding credits already-deducted by the executor are
 *    refunded by that executor's catch block. The orchestrator marks the run
 *    failed and returns.
 *  - Startup sweep: any run stuck in 'running' for >30 min on module load is
 *    marked failed with reason 'orchestrator restarted'.
 */
import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { TRPCError } from '@trpc/server';
import { db } from '../../lib/firebase';
import {
  estimateCost,
  getRun,
  getWorkflow,
  topologicalLayers,
  workflowRunsCol,
  assertWorkflowRunnable,
} from './workflows.handlers';
import { getNodeExecutor } from './workflows.nodes';
import { assertGenerationAllowed } from '../../lib/generation-guards';
import type { NodeRun, WorkflowGraph, WorkflowRun, WorkflowRunStatus } from './workflows.types';

const MAX_PARALLEL_NODES = 4;
const STUCK_RUN_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

// In-memory abort registry. A restart loses these — combined with the stuck-run
// sweep below, that's acceptable for Phase 1.
const runAbortRegistry = new Map<string, AbortController>();

// ── Public API ─────────────────────────────────────────────────────────

export interface StartRunResult {
  runId: string;
}

/**
 * Create a run doc and kick off async execution. Returns immediately with the
 * runId — callers poll `getRun` for progress.
 */
export async function startWorkflowRun(args: {
  workflowId: string;
  ownerUid: string;
  overrides: Record<string, Record<string, unknown>>;
}): Promise<StartRunResult> {
  const workflow = await getWorkflow(args.workflowId);
  if (!workflow) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' });
  }
  assertWorkflowRunnable(workflow, args.ownerUid);

  if (workflow.graph.nodes.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Cannot run an empty workflow',
    });
  }

  // Pre-flight credit gate — sum estimate, then check both kill switch + spend cap.
  const { creditsTotal } = estimateCost(workflow.graph);
  await assertGenerationAllowed(args.ownerUid, creditsTotal);

  const runId = randomUUID();
  const startedAt = Date.now();

  const run: WorkflowRun = {
    id: runId,
    workflowId: workflow.id,
    ownerUid: args.ownerUid,
    graphSnapshot: workflow.graph,
    nodeRuns: [],
    status: 'queued',
    totalCostCredits: 0,
    inputs: args.overrides,
    outputs: {},
    startedAt,
    finishedAt: null,
    error: null,
  };
  await workflowRunsCol().doc(runId).set(run);

  // Kick off async — do not await
  executeRun(runId).catch((err) => {
    console.error(`[workflows.executor] Unhandled error in run ${runId}:`, err);
  });

  return { runId };
}

/**
 * Cancel an in-flight run. Owner-only. Signals an AbortError to all running
 * node executors; the orchestrator finalizes status='cancelled' on its next loop.
 */
export async function cancelRun(runId: string, ownerUid: string): Promise<void> {
  const run = await getRun(runId, ownerUid);
  if (run.status !== 'queued' && run.status !== 'running') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Run is ${run.status}, cannot cancel`,
    });
  }
  const controller = runAbortRegistry.get(runId);
  if (controller) controller.abort();
  await workflowRunsCol()
    .doc(runId)
    .update({
      status: 'cancelled' as WorkflowRunStatus,
      finishedAt: Date.now(),
      error: 'cancelled by user',
    });
}

// ── Orchestrator ───────────────────────────────────────────────────────

async function executeRun(runId: string): Promise<void> {
  const runDoc = await workflowRunsCol().doc(runId).get();
  if (!runDoc.exists) return;
  const run = runDoc.data() as WorkflowRun;

  const controller = new AbortController();
  runAbortRegistry.set(runId, controller);

  try {
    await workflowRunsCol().doc(runId).update({ status: 'running' });

    const layers = topologicalLayers(run.graphSnapshot);
    // nodeId → output map
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    const completedNodeRuns: NodeRun[] = [];

    for (const layer of layers) {
      controller.signal.throwIfAborted();

      // Run nodes in this layer with capped parallelism
      const results = await runWithConcurrencyCap(layer, MAX_PARALLEL_NODES, async (nodeId) => {
        const node = run.graphSnapshot.nodes.find((n) => n.id === nodeId)!;
        const overrides = (run.inputs[nodeId] || {}) as Record<string, unknown>;

        // Merge stored params + per-run overrides
        const params = {
          ...(node.data as Record<string, unknown>),
          ...overrides,
        } as typeof node.data;

        // Build inputs from upstream node outputs
        const inputs = collectInputs(run.graphSnapshot, nodeId, nodeOutputs);

        const startedAt = Date.now();
        const nodeRun: NodeRun = {
          id: randomUUID(),
          nodeId,
          kind: node.type,
          inputs,
          outputs: {},
          modelUsed: null,
          providerCostUsd: 0,
          creditsCharged: 0,
          durationMs: 0,
          status: 'running',
          error: null,
          startedAt,
          finishedAt: null,
        };

        try {
          const executor = getNodeExecutor(node.type);
          const exec = await executor.execute({
            params: params as never,
            inputs,
            ctx: {
              ownerUid: run.ownerUid,
              runId,
              nodeId,
              signal: controller.signal,
            },
          });
          nodeRun.outputs = exec.outputs;
          nodeRun.modelUsed = exec.modelUsed;
          nodeRun.providerCostUsd = exec.providerCostUsd;
          nodeRun.creditsCharged = exec.creditsCharged;
          nodeRun.status = 'succeeded';
          nodeRun.finishedAt = Date.now();
          nodeRun.durationMs = nodeRun.finishedAt - startedAt;

          nodeOutputs.set(nodeId, exec.outputs);
          return nodeRun;
        } catch (err) {
          nodeRun.status = controller.signal.aborted ? 'cancelled' : 'failed';
          nodeRun.error = err instanceof Error ? err.message : String(err);
          nodeRun.finishedAt = Date.now();
          nodeRun.durationMs = nodeRun.finishedAt - startedAt;
          throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
            __nodeRun: nodeRun,
          });
        }
      });

      // Persist all node runs from this layer (write-once via arrayUnion)
      for (const nr of results.completed) {
        completedNodeRuns.push(nr);
        await workflowRunsCol()
          .doc(runId)
          .update({ nodeRuns: FieldValue.arrayUnion(nr) });
      }

      // If any node in the layer failed, persist the failed NodeRun and abort.
      if (results.failedNodeRun) {
        completedNodeRuns.push(results.failedNodeRun);
        await workflowRunsCol()
          .doc(runId)
          .update({ nodeRuns: FieldValue.arrayUnion(results.failedNodeRun) });

        const totalCost = completedNodeRuns.reduce((s, n) => s + n.creditsCharged, 0);
        await workflowRunsCol()
          .doc(runId)
          .update({
            status: results.failedNodeRun.status === 'cancelled' ? 'cancelled' : 'failed',
            totalCostCredits: totalCost,
            finishedAt: Date.now(),
            error: results.failedNodeRun.error,
          });
        return;
      }
    }

    // Build outputs from terminal nodes
    const outgoingFrom = new Set(run.graphSnapshot.edges.map((e) => e.source));
    const terminalIds = run.graphSnapshot.nodes
      .map((n) => n.id)
      .filter((id) => !outgoingFrom.has(id));
    const outputs: Record<string, Record<string, unknown>> = {};
    for (const id of terminalIds) {
      const out = nodeOutputs.get(id);
      if (out) outputs[id] = out;
    }

    const totalCost = completedNodeRuns.reduce((s, n) => s + n.creditsCharged, 0);
    await workflowRunsCol().doc(runId).update({
      status: 'succeeded',
      totalCostCredits: totalCost,
      outputs,
      finishedAt: Date.now(),
    });
  } catch (err) {
    console.error(`[workflows.executor] Run ${runId} crashed:`, err);
    try {
      await workflowRunsCol()
        .doc(runId)
        .update({
          status: 'failed',
          finishedAt: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
    } catch (writeErr) {
      console.error(`[workflows.executor] Failed to mark ${runId} failed:`, writeErr);
    }
  } finally {
    runAbortRegistry.delete(runId);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function collectInputs(
  graph: WorkflowGraph,
  nodeId: string,
  nodeOutputs: Map<string, Record<string, unknown>>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue;
    const upstream = nodeOutputs.get(edge.source);
    if (!upstream) continue;
    if (edge.targetHandle && edge.sourceHandle) {
      inputs[edge.targetHandle] = upstream[edge.sourceHandle];
    } else if (edge.targetHandle) {
      // No source handle specified — copy by name from upstream
      inputs[edge.targetHandle] = upstream[edge.targetHandle] ?? Object.values(upstream)[0];
    } else if (edge.sourceHandle) {
      inputs[edge.sourceHandle] = upstream[edge.sourceHandle];
    } else {
      // Default: copy upstream's first output by its key
      for (const [k, v] of Object.entries(upstream)) {
        if (!(k in inputs)) inputs[k] = v;
      }
    }
  }
  return inputs;
}

interface LayerResult {
  completed: NodeRun[];
  failedNodeRun: NodeRun | null;
}

async function runWithConcurrencyCap(
  ids: string[],
  cap: number,
  task: (id: string) => Promise<NodeRun>
): Promise<LayerResult> {
  const completed: NodeRun[] = [];
  let failedNodeRun: NodeRun | null = null;

  const queue = [...ids];
  async function worker() {
    while (queue.length > 0 && !failedNodeRun) {
      const id = queue.shift()!;
      try {
        const nr = await task(id);
        completed.push(nr);
      } catch (err) {
        const carried = (err as { __nodeRun?: NodeRun }).__nodeRun;
        if (carried && !failedNodeRun) failedNodeRun = carried;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(cap, ids.length) }, () => worker()));
  return { completed, failedNodeRun };
}

// ── Startup sweep: orphaned runs ──────────────────────────────────────

let sweepRan = false;
export async function sweepOrphanedRuns(): Promise<void> {
  if (sweepRan) return;
  sweepRan = true;
  if (!db) return;
  try {
    const cutoff = Date.now() - STUCK_RUN_THRESHOLD_MS;
    const snap = await workflowRunsCol()
      .where('status', 'in', ['queued', 'running'])
      .where('startedAt', '<', cutoff)
      .limit(100)
      .get();
    for (const doc of snap.docs) {
      await doc.ref.update({
        status: 'failed' as WorkflowRunStatus,
        finishedAt: Date.now(),
        error: 'orchestrator restarted',
      });
    }
    if (snap.size > 0) {
      console.log(`[workflows.executor] Swept ${snap.size} orphaned run(s)`);
    }
  } catch (err) {
    console.error('[workflows.executor] sweepOrphanedRuns failed:', err);
  }
}

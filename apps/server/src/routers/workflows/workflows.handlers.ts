/**
 * Workflow Firestore CRUD + graph validation.
 *
 * Firestore collections:
 *   workflows      — authored DAGs (one doc per workflow)
 *   workflowRuns   — per-execution audit records (immutable once finished)
 */
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { db } from '../../lib/firebase';
import {
  WORKFLOW_LIMITS,
  type NodeParams,
  type Workflow,
  type WorkflowGraph,
  type WorkflowRun,
  type WorkflowVisibility,
} from './workflows.types';
import { NODE_IO_CONTRACTS, estimateNodeCost } from './workflows.nodes';

// ── Collections ────────────────────────────────────────────────────────

export function workflowsCol() {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('workflows');
}

export function workflowRunsCol() {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('workflowRuns');
}

// ── Helpers ────────────────────────────────────────────────────────────

function now(): number {
  return Date.now();
}

function emptyGraph(): WorkflowGraph {
  return { nodes: [], edges: [] };
}

function canView(workflow: Workflow, viewerUid: string | null): boolean {
  if (workflow.status === 'archived') {
    return viewerUid === workflow.ownerUid;
  }
  switch (workflow.visibility) {
    case 'private':
      return viewerUid === workflow.ownerUid;
    case 'collaborator':
      return (
        viewerUid === workflow.ownerUid ||
        (viewerUid !== null && workflow.collaboratorUids.includes(viewerUid))
      );
    case 'paid':
    case 'canon':
      return true; // Phase 2: paid needs license check; canon needs universe gate
  }
}

// ── Graph validation ───────────────────────────────────────────────────

/**
 * Throws TRPCError on any structural problem. Phase 1 checks:
 *  1. Every edge endpoint exists in nodes
 *  2. Handles match per-kind I/O contract
 *  3. No cycles (Kahn's algorithm)
 *  4. At least one terminal node (unless graph is empty)
 *  5. No duplicate node/edge ids
 *  6. Node count <= MAX_NODES
 */
export function validateGraph(graph: WorkflowGraph): void {
  const { nodes, edges } = graph;

  if (nodes.length > WORKFLOW_LIMITS.MAX_NODES) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Workflow has ${nodes.length} nodes, max is ${WORKFLOW_LIMITS.MAX_NODES}`,
    });
  }

  const nodeIds = new Set<string>();
  for (const n of nodes) {
    if (nodeIds.has(n.id)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Duplicate node id: ${n.id}` });
    }
    nodeIds.add(n.id);

    // data.kind must match the node.type
    if (n.data.kind !== n.type) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Node ${n.id} type "${n.type}" does not match data.kind "${n.data.kind}"`,
      });
    }
  }

  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (edgeIds.has(e.id)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Duplicate edge id: ${e.id}` });
    }
    edgeIds.add(e.id);

    if (!nodeIds.has(e.source)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Edge ${e.id} source ${e.source} is not a known node`,
      });
    }
    if (!nodeIds.has(e.target)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Edge ${e.id} target ${e.target} is not a known node`,
      });
    }
    if (e.source === e.target) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Edge ${e.id} connects a node to itself`,
      });
    }
  }

  // Per-kind I/O handle validation
  const nodeByid = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const src = nodeByid.get(e.source)!;
    const tgt = nodeByid.get(e.target)!;

    const srcContract = NODE_IO_CONTRACTS[src.type];
    const tgtContract = NODE_IO_CONTRACTS[tgt.type];

    if (srcContract.outputs.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Node ${src.id} (${src.type}) produces no outputs, cannot be edge source`,
      });
    }
    if (tgtContract.inputs.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Node ${tgt.id} (${tgt.type}) accepts no inputs, cannot be edge target`,
      });
    }

    // If handles are specified, ensure they exist in the contract
    if (e.sourceHandle && !srcContract.outputs.includes(e.sourceHandle)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Edge ${e.id} sourceHandle "${e.sourceHandle}" is not valid for ${src.type} (valid: ${srcContract.outputs.join(', ')})`,
      });
    }
    if (e.targetHandle && !tgtContract.inputs.includes(e.targetHandle)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Edge ${e.id} targetHandle "${e.targetHandle}" is not valid for ${tgt.type} (valid: ${tgtContract.inputs.join(', ')})`,
      });
    }
  }

  if (nodes.length === 0) return; // Empty graph is valid (placeholder)

  // Cycle detection via Kahn's algorithm
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const queue: string[] = [];
  for (const [id, d] of indeg) {
    if (d === 0) queue.push(id);
  }
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const next of adj.get(id)!) {
      indeg.set(next, indeg.get(next)! - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== nodes.length) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Workflow graph contains a cycle',
    });
  }

  // At least one terminal node (no outgoing edges)
  const hasOutgoing = new Set(edges.map((e) => e.source));
  const terminals = nodes.filter((n) => !hasOutgoing.has(n.id));
  if (terminals.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Workflow graph has no terminal node (every node has an outgoing edge)',
    });
  }
}

/** Group nodes by topological depth (Kahn) so each layer can run in parallel. */
export function topologicalLayers(graph: WorkflowGraph): string[][] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const layers: string[][] = [];
  let frontier = graph.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  while (frontier.length > 0) {
    layers.push(frontier);
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      for (const next of adj.get(id)!) {
        indeg.set(next, indeg.get(next)! - 1);
        if (indeg.get(next) === 0) nextFrontier.push(next);
      }
    }
    frontier = nextFrontier;
  }
  return layers;
}

export function estimateCost(graph: WorkflowGraph): {
  creditsTotal: number;
  perNode: Record<string, number>;
} {
  const perNode: Record<string, number> = {};
  let total = 0;
  for (const n of graph.nodes) {
    const c = estimateNodeCost(n.data as NodeParams);
    perNode[n.id] = c;
    total += c;
  }
  return { creditsTotal: total, perNode };
}

// ── CRUD ───────────────────────────────────────────────────────────────

export interface CreateWorkflowInput {
  name: string;
  description: string;
  graph: WorkflowGraph;
  universeAddress?: string | null;
}

export async function createWorkflow(
  input: CreateWorkflowInput,
  ownerUid: string
): Promise<Workflow> {
  validateGraph(input.graph);
  const ts = now();
  const workflow: Workflow = {
    id: randomUUID(),
    ownerUid,
    name: input.name,
    description: input.description,
    graph: input.graph,
    version: 1,
    visibility: 'private',
    priceCredits: 0,
    universeAddress: input.universeAddress ?? null,
    status: 'draft',
    contentStatus: 'active',
    collaboratorUids: [],
    forkedFrom: null,
    createdAt: ts,
    updatedAt: ts,
  };
  await workflowsCol().doc(workflow.id).set(workflow);
  return workflow;
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  const doc = await workflowsCol().doc(id).get();
  if (!doc.exists) return null;
  return doc.data() as Workflow;
}

export async function getWorkflowFor(id: string, viewerUid: string | null): Promise<Workflow> {
  const workflow = await getWorkflow(id);
  if (!workflow) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' });
  }
  if (!canView(workflow, viewerUid)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this workflow' });
  }
  return workflow;
}

export async function listWorkflowsByOwner(ownerUid: string, limit = 100): Promise<Workflow[]> {
  const snap = await workflowsCol()
    .where('ownerUid', '==', ownerUid)
    .where('status', 'in', ['draft', 'active'])
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as Workflow);
}

export async function listWorkflowsByUniverse(
  universeAddress: string,
  limit = 100
): Promise<Workflow[]> {
  const snap = await workflowsCol()
    .where('universeAddress', '==', universeAddress.toLowerCase())
    .where('status', '==', 'active')
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as Workflow);
}

export interface UpdateWorkflowPatch {
  name?: string;
  description?: string;
  graph?: WorkflowGraph;
  visibility?: WorkflowVisibility;
  collaboratorUids?: string[];
  priceCredits?: number;
  universeAddress?: string | null;
}

export async function updateWorkflow(
  id: string,
  patch: UpdateWorkflowPatch,
  ownerUid: string,
  callerAddress: string | null = null
): Promise<Workflow> {
  const existing = await getWorkflow(id);
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' });
  if (existing.ownerUid !== ownerUid) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner can update this workflow' });
  }

  if (patch.graph) validateGraph(patch.graph);

  // Phase 2: paid/canon visibility require extra rule checks.
  if (patch.visibility === 'paid' || patch.visibility === 'canon') {
    // Lazy-import to avoid circular dep (marketplace module imports handlers).
    const { assertPublishAllowed } = await import('./workflows.marketplace');
    await assertPublishAllowed({
      current: existing,
      nextVisibility: patch.visibility,
      nextPriceCredits: patch.priceCredits,
      nextUniverseAddress: patch.universeAddress,
      callerAddress,
    });
  }

  const next: Workflow = {
    ...existing,
    ...patch,
    universeAddress:
      patch.universeAddress === undefined ? existing.universeAddress : patch.universeAddress,
    version: existing.version + (patch.graph ? 1 : 0),
    status: existing.status === 'draft' && patch.graph ? 'active' : existing.status,
    updatedAt: now(),
  };
  await workflowsCol().doc(id).set(next);
  return next;
}

export async function forkWorkflow(id: string, ownerUid: string): Promise<Workflow> {
  const source = await getWorkflow(id);
  if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' });
  if (!canView(source, ownerUid)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You cannot fork a workflow you cannot view',
    });
  }

  const ts = now();
  const fork: Workflow = {
    id: randomUUID(),
    ownerUid,
    name: `${source.name} (fork)`,
    description: source.description,
    graph: JSON.parse(JSON.stringify(source.graph)) as WorkflowGraph,
    version: 1,
    visibility: 'private',
    priceCredits: 0,
    universeAddress: null,
    status: 'draft',
    contentStatus: 'active',
    collaboratorUids: [],
    forkedFrom: source.id,
    createdAt: ts,
    updatedAt: ts,
  };
  await workflowsCol().doc(fork.id).set(fork);
  return fork;
}

export async function archiveWorkflow(id: string, ownerUid: string): Promise<void> {
  const existing = await getWorkflow(id);
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' });
  if (existing.ownerUid !== ownerUid) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner can archive' });
  }
  await workflowsCol().doc(id).update({ status: 'archived', updatedAt: now() });
}

// ── Run helpers ────────────────────────────────────────────────────────

export async function getRun(id: string, ownerUid: string): Promise<WorkflowRun> {
  const doc = await workflowRunsCol().doc(id).get();
  if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
  const run = doc.data() as WorkflowRun;
  if (run.ownerUid !== ownerUid) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this run' });
  }
  return run;
}

export async function listRuns(
  workflowId: string,
  ownerUid: string,
  limit = 50
): Promise<WorkflowRun[]> {
  const snap = await workflowRunsCol()
    .where('workflowId', '==', workflowId)
    .where('ownerUid', '==', ownerUid)
    .orderBy('startedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as WorkflowRun);
}

/**
 * Assert the workflow can be run by this user. Checks visibility + collaborator
 * gate; paid/canon gating is delegated to the marketplace module.
 */
export async function assertWorkflowRunnable(workflow: Workflow, runnerUid: string): Promise<void> {
  if (workflow.contentStatus === 'removed' || workflow.contentStatus === 'hidden') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Workflow is ${workflow.contentStatus}`,
    });
  }
  switch (workflow.visibility) {
    case 'private':
      if (workflow.ownerUid !== runnerUid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Private workflow' });
      }
      return;
    case 'collaborator':
      if (workflow.ownerUid !== runnerUid && !workflow.collaboratorUids.includes(runnerUid)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Collaborator access required' });
      }
      return;
    case 'paid':
    case 'canon': {
      const { assertMarketplaceRunAllowed } = await import('./workflows.marketplace');
      await assertMarketplaceRunAllowed(workflow, runnerUid);
      return;
    }
  }
}

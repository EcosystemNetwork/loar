/**
 * Pure-function tests for workflow graph validation + topological ordering.
 * No Firestore — exercises only the static helpers in workflows.handlers.ts
 * and the io contracts in workflows.nodes.ts.
 */
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  validateGraph,
  topologicalLayers,
  estimateCost,
} from '../routers/workflows/workflows.handlers';
import { assertPublishAllowed } from '../routers/workflows/workflows.marketplace';
import type { Workflow, WorkflowGraph } from '../routers/workflows/workflows.types';

const promptDefaults = { kind: 'prompt' as const, text: 'a sunset', aspectRatio: '1:1' as const };
const refDefaults = { kind: 'ref' as const, assetUrl: 'https://example.com/x.png' };
const animateDefaults = {
  kind: 'animate' as const,
  durationSec: 5,
  aspectRatio: '16:9' as const,
  modelHint: 'balanced' as const,
};
const upscaleDefaults = { kind: 'upscale' as const, factor: 4 as const };

describe('workflows validateGraph', () => {
  it('accepts an empty graph', () => {
    expect(() => validateGraph({ nodes: [], edges: [] })).not.toThrow();
  });

  it('accepts a linear prompt → animate → upscale graph (image branch only)', () => {
    // animate emits videoUrl, so terminal upscale (image-only) needs to come from
    // a different branch. Linear prompt → upscale is the right "still" branch.
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: promptDefaults },
        { id: 'u1', type: 'upscale', position: { x: 200, y: 0 }, data: upscaleDefaults },
      ],
      edges: [
        {
          id: 'e1',
          source: 'p1',
          target: 'u1',
          sourceHandle: 'imageUrl',
          targetHandle: 'imageUrl',
        },
      ],
    };
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it('accepts ref → animate (image-to-video)', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'r1', type: 'ref', position: { x: 0, y: 0 }, data: refDefaults },
        { id: 'a1', type: 'animate', position: { x: 200, y: 0 }, data: animateDefaults },
      ],
      edges: [
        {
          id: 'e1',
          source: 'r1',
          target: 'a1',
          sourceHandle: 'imageUrl',
          targetHandle: 'imageUrl',
        },
      ],
    };
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it('rejects edge to unknown node', () => {
    const graph: WorkflowGraph = {
      nodes: [{ id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: promptDefaults }],
      edges: [
        {
          id: 'e1',
          source: 'p1',
          target: 'ghost',
          sourceHandle: 'imageUrl',
          targetHandle: 'imageUrl',
        },
      ],
    };
    expect(() => validateGraph(graph)).toThrow(TRPCError);
  });

  it('rejects self-loops', () => {
    const graph: WorkflowGraph = {
      nodes: [{ id: 'a1', type: 'animate', position: { x: 0, y: 0 }, data: animateDefaults }],
      edges: [
        {
          id: 'e1',
          source: 'a1',
          target: 'a1',
          sourceHandle: 'videoUrl',
          targetHandle: 'imageUrl',
        },
      ],
    };
    expect(() => validateGraph(graph)).toThrow(TRPCError);
  });

  it('rejects cycles (3-node loop)', () => {
    // Cycle is constructed structurally; handle compatibility is irrelevant
    // because we only assert the cycle detector throws.
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: promptDefaults },
        { id: 'u1', type: 'upscale', position: { x: 100, y: 0 }, data: upscaleDefaults },
        { id: 'u2', type: 'upscale', position: { x: 200, y: 0 }, data: upscaleDefaults },
      ],
      edges: [
        {
          id: 'e1',
          source: 'p1',
          target: 'u1',
          sourceHandle: 'imageUrl',
          targetHandle: 'imageUrl',
        },
        {
          id: 'e2',
          source: 'u1',
          target: 'u2',
          sourceHandle: 'imageUrl',
          targetHandle: 'imageUrl',
        },
        {
          id: 'e3',
          source: 'u2',
          target: 'u1',
          sourceHandle: 'imageUrl',
          targetHandle: 'imageUrl',
        },
      ],
    };
    expect(() => validateGraph(graph)).toThrow(/cycle/i);
  });

  it('rejects invalid handle on a kind contract', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: promptDefaults },
        { id: 'u1', type: 'upscale', position: { x: 200, y: 0 }, data: upscaleDefaults },
      ],
      edges: [
        {
          id: 'e1',
          source: 'p1',
          target: 'u1',
          sourceHandle: 'videoUrl',
          targetHandle: 'imageUrl',
        },
      ],
    };
    expect(() => validateGraph(graph)).toThrow(/sourceHandle/);
  });

  it('rejects duplicate node ids', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: promptDefaults },
        { id: 'p1', type: 'upscale', position: { x: 200, y: 0 }, data: upscaleDefaults },
      ],
      edges: [],
    };
    expect(() => validateGraph(graph)).toThrow(/Duplicate/);
  });

  it('rejects when data.kind disagrees with node.type', () => {
    const graph: WorkflowGraph = {
      nodes: [
        {
          id: 'x',
          type: 'prompt',
          position: { x: 0, y: 0 },
          data: { ...upscaleDefaults } as never,
        },
      ],
      edges: [],
    };
    expect(() => validateGraph(graph)).toThrow();
  });
});

describe('workflows topologicalLayers', () => {
  it('groups parallel branches into one layer', () => {
    // Two prompt sources both feed an upscale terminal
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: promptDefaults },
        { id: 'p2', type: 'prompt', position: { x: 0, y: 100 }, data: promptDefaults },
        { id: 'u1', type: 'upscale', position: { x: 300, y: 50 }, data: upscaleDefaults },
      ],
      edges: [
        {
          id: 'e1',
          source: 'p1',
          target: 'u1',
          sourceHandle: 'imageUrl',
          targetHandle: 'imageUrl',
        },
        {
          id: 'e2',
          source: 'p2',
          target: 'u1',
          sourceHandle: 'imageUrl',
          targetHandle: 'imageUrl',
        },
      ],
    };
    const layers = topologicalLayers(graph);
    expect(layers).toHaveLength(2);
    expect(layers[0].sort()).toEqual(['p1', 'p2']);
    expect(layers[1]).toEqual(['u1']);
  });
});

describe('workflows estimateCost', () => {
  it('returns 0 for an empty graph', () => {
    const result = estimateCost({ nodes: [], edges: [] });
    expect(result.creditsTotal).toBe(0);
    expect(result.perNode).toEqual({});
  });

  it('sums per-node estimates', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: promptDefaults },
        { id: 'r1', type: 'ref', position: { x: 0, y: 100 }, data: refDefaults },
        { id: 'u1', type: 'upscale', position: { x: 200, y: 0 }, data: upscaleDefaults },
      ],
      edges: [],
    };
    const result = estimateCost(graph);
    // prompt = 3, ref = 0, upscale ×4 = 10 → 13
    expect(result.creditsTotal).toBe(13);
    expect(result.perNode.p1).toBe(3);
    expect(result.perNode.r1).toBe(0);
    expect(result.perNode.u1).toBe(10);
  });
});

// ── Phase 2: paid + canon publish gate ────────────────────────────────

const baseWorkflow: Workflow = {
  id: 'w1',
  ownerUid: 'owner-uid',
  name: 'Test',
  description: '',
  graph: {
    nodes: [{ id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: promptDefaults }],
    edges: [],
  },
  version: 1,
  visibility: 'private',
  priceCredits: 0,
  universeAddress: null,
  status: 'active',
  contentStatus: 'active',
  collaboratorUids: [],
  forkedFrom: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('workflows assertPublishAllowed', () => {
  it('passes through for private/collaborator visibility', async () => {
    await expect(
      assertPublishAllowed({
        current: baseWorkflow,
        nextVisibility: 'private',
        callerAddress: null,
      })
    ).resolves.toBeUndefined();
    await expect(
      assertPublishAllowed({
        current: baseWorkflow,
        nextVisibility: 'collaborator',
        callerAddress: null,
      })
    ).resolves.toBeUndefined();
  });

  it('rejects paid without priceCredits >= 1', async () => {
    await expect(
      assertPublishAllowed({
        current: baseWorkflow,
        nextVisibility: 'paid',
        nextPriceCredits: 0,
        callerAddress: '0xabc',
      })
    ).rejects.toThrow(/priceCredits/);
  });

  it('accepts paid with valid priceCredits', async () => {
    await expect(
      assertPublishAllowed({
        current: baseWorkflow,
        nextVisibility: 'paid',
        nextPriceCredits: 5,
        callerAddress: '0xabc',
      })
    ).resolves.toBeUndefined();
  });

  it('rejects paid for empty graph', async () => {
    const empty = { ...baseWorkflow, graph: { nodes: [], edges: [] } };
    await expect(
      assertPublishAllowed({
        current: empty,
        nextVisibility: 'paid',
        nextPriceCredits: 5,
        callerAddress: '0xabc',
      })
    ).rejects.toThrow(/empty workflow/);
  });

  it('rejects canon without universeAddress', async () => {
    await expect(
      assertPublishAllowed({
        current: baseWorkflow,
        nextVisibility: 'canon',
        nextUniverseAddress: null,
        callerAddress: '0xabc',
      })
    ).rejects.toThrow(/universeAddress/);
  });

  it('rejects canon without a connected wallet', async () => {
    await expect(
      assertPublishAllowed({
        current: baseWorkflow,
        nextVisibility: 'canon',
        nextUniverseAddress: '0x0000000000000000000000000000000000000001',
        callerAddress: null,
      })
    ).rejects.toThrow(/connected wallet/);
  });
});

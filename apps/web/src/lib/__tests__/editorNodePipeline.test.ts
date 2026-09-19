/**
 * End-to-end regression tests for the universe editor's node-build pipeline:
 * buildGraphData() → resolveArchivedNodeIds() → buildSceneFlowGraph() →
 * mergeDraftNodes() → appendAddFinalNode() — the exact chain run by
 * universe/$id.tsx's "Convert blockchain data to timeline nodes" effect.
 *
 * The individual stages are each unit-tested in universeGraphData.test.ts and
 * timelineFlowGraph.test.ts. This file exists because the "editor nodes
 * disappear" bug has recurred multiple times (3031070a, 74b4b736, 641b9039,
 * c9a0f9c1) with the root cause each time living at the SEAM between two
 * otherwise-correct stages — e.g. cbd4e615, where $id.tsx reimplemented the
 * archive guard inline instead of calling the tested resolveArchivedNodeIds,
 * so the two copies could silently drift even though both passed their own
 * tests. Running the real chain end-to-end, with combinations of hidden
 * on-chain overrides + localStorage archive lists + unsaved drafts, is the
 * only way to catch that class of bug.
 */
import { describe, expect, it } from 'vitest';
import {
  buildGraphData,
  type NodeMediaOverride,
  type RawFullGraph,
} from '@/hooks/universeGraphData';
import {
  appendAddFinalNode,
  buildSceneFlowGraph,
  mergeDraftNodes,
  resolveArchivedNodeIds,
} from '@/lib/timelineFlowGraph';
import { calculateTreeLayout } from '@/utils/treeLayout';
import { TIMELINE_LAYOUT_CONFIG } from '@/lib/timelineFlowGraph';

const HASH = (n: number) => '0x' + n.toString().padStart(64, '0');

/** Run the exact chain the editor effect runs, given raw inputs. */
function runPipeline(args: {
  useOnChain: boolean;
  onChainContractAddress?: string;
  fullGraphData?: RawFullGraph;
  canonChainData?: readonly (string | number | bigint)[];
  mediaOverrides?: Record<number, NodeMediaOverride>;
  offChainNodes?: readonly any[];
  storedArchivedNodeIds?: ReadonlySet<string>;
  localEvents?: Record<string, any>;
  universeId?: string;
}) {
  const graphData = buildGraphData({
    useOnChain: args.useOnChain,
    onChainContractAddress: args.onChainContractAddress,
    fullGraphData: args.fullGraphData,
    canonChainData: args.canonChainData,
    mediaOverrides: args.mediaOverrides,
    offChainNodes: args.offChainNodes,
  });

  const { archivedNodeIds, wouldHideEveryNode } = resolveArchivedNodeIds({
    storedArchivedNodeIds: args.storedArchivedNodeIds ?? new Set(),
    allNodeIds: graphData.nodeIds,
  });

  const layout = calculateTreeLayout(
    graphData.nodeIds,
    graphData.previousNodes,
    TIMELINE_LAYOUT_CONFIG
  );

  const scene = buildSceneFlowGraph({
    graphData,
    layout,
    archivedNodeIds,
    localEvents: args.localEvents ?? {},
    universeId: args.universeId ?? 'uni-1',
  });

  const onChainNodeIds = new Set(graphData.nodeIds.map((n) => String(n)));
  const withDrafts = mergeDraftNodes({
    nodes: scene.nodes,
    edges: scene.edges,
    localEvents: args.localEvents ?? {},
    onChainNodeIds,
    universeId: args.universeId ?? 'uni-1',
    timelineId: 'timeline-uni-1',
  });

  const final = appendAddFinalNode(withDrafts);

  return { graphData, wouldHideEveryNode, ...final };
}

/** A linear 3-node on-chain graph: 1 ← 2 ← 3. */
function threeNodeOnChainGraph(): RawFullGraph {
  return [
    [1, 2, 3],
    [HASH(1), HASH(2), HASH(3)],
    [HASH(11), HASH(12), HASH(13)],
    [0, 1, 2],
    [[2], [3], []],
    [true, false, false],
  ];
}

describe('editor node pipeline — plain graphs render every node', () => {
  it('on-chain: 3 nodes in → 3 scene nodes + 1 add-final node out, none dropped', () => {
    const { nodes } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
    });
    expect(nodes.map((n) => n.id)).toEqual([
      'blockchain-node-1',
      'blockchain-node-2',
      'blockchain-node-3',
      'add-final',
    ]);
  });

  it('off-chain: every offChainNodes doc becomes a scene node', () => {
    const offChainNodes = [
      { nodeId: 1, previousNodeId: 0, children: [2], videoUrl: 'https://x/1.mp4', canon: true },
      { nodeId: 2, previousNodeId: 1, children: [], videoUrl: 'https://x/2.mp4', canon: false },
    ];
    const { nodes } = runPipeline({ useOnChain: false, offChainNodes });
    expect(nodes.map((n) => n.id)).toEqual(['blockchain-node-1', 'blockchain-node-2', 'add-final']);
  });

  it('a universe with no contract address and useOnChain=true renders an empty (not crashed) graph', () => {
    // onChainContractAddress undefined during the pre-resolve window — must
    // not throw, and must not silently render stale nodes from a prior render.
    const { nodes, wouldHideEveryNode } = runPipeline({
      useOnChain: true,
      onChainContractAddress: undefined,
      fullGraphData: threeNodeOnChainGraph(),
    });
    expect(nodes).toEqual([]);
    expect(wouldHideEveryNode).toBe(false);
  });
});

describe('editor node pipeline — hidden-override guard survives the full chain', () => {
  it('one node hidden: survives to the final node list minus that one node', () => {
    const { nodes } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
      mediaOverrides: { 2: { hidden: true } },
    });
    expect(nodes.map((n) => n.id)).toEqual(['blockchain-node-1', 'blockchain-node-3', 'add-final']);
  });

  it('every node hidden via override: guard fires, all 3 nodes still reach the canvas', () => {
    const { nodes, wouldHideEveryNode } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
      mediaOverrides: { 1: { hidden: true }, 2: { hidden: true }, 3: { hidden: true } },
    });
    expect(wouldHideEveryNode).toBe(false); // this guard lives in buildOnChainGraphData, not resolveArchivedNodeIds
    expect(nodes.map((n) => n.id)).toEqual([
      'blockchain-node-1',
      'blockchain-node-2',
      'blockchain-node-3',
      'add-final',
    ]);
  });
});

describe('editor node pipeline — archive-list guard survives the full chain', () => {
  it('a partial archive list correctly hides just those nodes', () => {
    const { nodes } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
      storedArchivedNodeIds: new Set(['2']),
    });
    expect(nodes.map((n) => n.id)).toEqual(['blockchain-node-1', 'blockchain-node-3', 'add-final']);
  });

  it('an archive list covering every surviving node is ignored end-to-end (Select-All -> Delete -> reload)', () => {
    const { nodes, wouldHideEveryNode } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
      storedArchivedNodeIds: new Set(['1', '2', '3']),
    });
    expect(wouldHideEveryNode).toBe(true);
    expect(nodes.map((n) => n.id)).toEqual([
      'blockchain-node-1',
      'blockchain-node-2',
      'blockchain-node-3',
      'add-final',
    ]);
  });

  it('stale archive list from a LARGER prior timeline (ids that no longer exist) does not block real nodes', () => {
    // e.g. nodes 4 and 5 were archived and later hard-pruned server-side;
    // the leftover browser localStorage entry must not affect 1-3 today.
    const { nodes } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
      storedArchivedNodeIds: new Set(['4', '5']),
    });
    expect(nodes.map((n) => n.id)).toEqual([
      'blockchain-node-1',
      'blockchain-node-2',
      'blockchain-node-3',
      'add-final',
    ]);
  });

  it('COMBINED: a hidden-override guard trip and an archive-list guard trip do not compound into an empty canvas', () => {
    // Every node hidden via override (guard #1 fires, ignored) AND the
    // archive list separately covers all 3 original ids (guard #2 fires,
    // ignored too). Neither guard should see the other's already-cleared
    // state and both must independently no-op.
    const { nodes, wouldHideEveryNode } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
      mediaOverrides: { 1: { hidden: true }, 2: { hidden: true }, 3: { hidden: true } },
      storedArchivedNodeIds: new Set(['1', '2', '3']),
    });
    expect(wouldHideEveryNode).toBe(true);
    expect(nodes.map((n) => n.id)).toEqual([
      'blockchain-node-1',
      'blockchain-node-2',
      'blockchain-node-3',
      'add-final',
    ]);
  });

  it('archive list that covers every SURVIVING node (after a legitimate partial hide) still trips the guard', () => {
    // Node 2 is legitimately hidden server-side (override). The archive list
    // then separately covers 1 and 3 - i.e. "every remaining node" from the
    // canvas's point of view, even though it never mentioned node 2.
    const { nodes, wouldHideEveryNode } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
      mediaOverrides: { 2: { hidden: true } },
      storedArchivedNodeIds: new Set(['1', '3']),
    });
    expect(wouldHideEveryNode).toBe(true);
    expect(nodes.map((n) => n.id)).toEqual(['blockchain-node-1', 'blockchain-node-3', 'add-final']);
  });
});

describe('editor node pipeline — unsaved drafts never vanish across a rebuild', () => {
  it('a draft generated this session (no on-chain id yet) survives the rebuild alongside on-chain nodes', () => {
    const { nodes } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
      localEvents: {
        'draft-1': {
          videoUrl: 'https://x/draft.mp4',
          title: 'Fresh clip',
          timestamp: Date.now(),
          sourceNodeId: 3,
        },
      },
    });
    expect(nodes.map((n) => n.id)).toEqual([
      'blockchain-node-1',
      'blockchain-node-2',
      'blockchain-node-3',
      'draft-1',
      'add-final',
    ]);
  });

  it('a draft survives even when its source node was archived out of the render', () => {
    const { nodes } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
      storedArchivedNodeIds: new Set(['3']),
      localEvents: {
        'draft-1': {
          videoUrl: 'https://x/draft.mp4',
          timestamp: Date.now(),
        },
      },
    });
    // Draft chains off the current tail (node 2, since 3 was archived), not lost.
    expect(nodes.map((n) => n.id)).toContain('draft-1');
    expect(nodes.map((n) => n.id)).not.toContain('blockchain-node-3');
  });

  it('a localEvents entry that IS on-chain is treated as saved metadata, not re-added as a duplicate draft node', () => {
    const { nodes } = runPipeline({
      useOnChain: true,
      onChainContractAddress: '0xUniverse',
      fullGraphData: threeNodeOnChainGraph(),
      localEvents: {
        '2': { videoUrl: 'https://x/2-local-override.mp4', title: 'Locally edited title' },
      },
    });
    expect(nodes.map((n) => n.id)).toEqual([
      'blockchain-node-1',
      'blockchain-node-2',
      'blockchain-node-3',
      'add-final',
    ]);
    const node2 = nodes.find((n) => n.id === 'blockchain-node-2')!;
    expect(node2.data.label).toBe('Locally edited title');
  });
});

describe('editor node pipeline — empty and single-node universes', () => {
  it('a brand-new off-chain universe with zero nodes yields an empty node list (no add-final without a base)', () => {
    const { nodes } = runPipeline({ useOnChain: false, offChainNodes: [] });
    expect(nodes).toEqual([]);
  });

  it('a single-node universe still gets its add-final connector', () => {
    const { nodes } = runPipeline({
      useOnChain: false,
      offChainNodes: [
        { nodeId: 1, previousNodeId: 0, children: [], videoUrl: 'https://x/1.mp4', canon: true },
      ],
    });
    expect(nodes.map((n) => n.id)).toEqual(['blockchain-node-1', 'add-final']);
  });
});

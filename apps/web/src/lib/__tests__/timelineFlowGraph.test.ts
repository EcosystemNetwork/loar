/**
 * Unit tests for timelineFlowGraph.ts — the graphData → ReactFlow
 * {nodes, edges} transform behind the universe timeline editor canvas
 * (universe/$id.tsx's "Convert blockchain data to timeline nodes" effect).
 * This is the code path directly behind the "node panel opens blank" class
 * of bugs, so its resolution rules are pinned here.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_GRAPH_DATA, type GraphData } from '@/hooks/universeGraphData';
import { calculateTreeLayout } from '@/utils/treeLayout';
import type { Edge, Node } from 'reactflow';
import type { TimelineNodeData } from '@/components/flow/TimelineNodes';
import {
  TIMELINE_LAYOUT_CONFIG,
  TIMELINE_NODE_COLORS,
  appendAddFinalNode,
  buildSceneFlowGraph,
  buildTimelineFlowGraph,
  mergeDraftNodes,
} from '../timelineFlowGraph';

const HASH = '0x' + 'a'.repeat(64);

/** Build a GraphData for a linear chain 1←2←3…, overridable per-field. */
function chain(n: number, over: Partial<GraphData> = {}): GraphData {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  return {
    ...EMPTY_GRAPH_DATA,
    nodeIds: ids,
    urls: ids.map(() => ''),
    descriptions: ids.map(() => ''),
    contentHashes: ids.map(() => ''),
    plotHashes: ids.map(() => ''),
    previousNodes: ids.map((_, i) => (i === 0 ? 0 : i)),
    children: ids.map((_, i) => (i === n - 1 ? [] : [i + 2])),
    flags: ids.map(() => false),
    canonChain: [],
    ...over,
  };
}

const build = (
  graphData: GraphData,
  over: Partial<Parameters<typeof buildTimelineFlowGraph>[0]> = {}
) =>
  buildTimelineFlowGraph({
    graphData,
    archivedNodeIds: new Set<string>(),
    localEvents: {},
    universeId: '0xuni',
    ...over,
  });

describe('buildTimelineFlowGraph — structure', () => {
  it('produces one node per graphData entry, id "blockchain-node-<id>", type timelineEvent', () => {
    const { nodes } = build(chain(3));
    expect(nodes.map((n) => n.id)).toEqual([
      'blockchain-node-1',
      'blockchain-node-2',
      'blockchain-node-3',
    ]);
    expect(nodes.every((n) => n.type === 'timelineEvent')).toBe(true);
    expect(nodes.every((n) => n.data.nodeType === 'scene')).toBe(true);
  });

  it('links each non-root node to its parent with an "edge-<prev>-<id>"', () => {
    const { edges } = build(chain(3));
    expect(edges.map((e) => e.id)).toEqual(['edge-1-2', 'edge-2-3']);
    expect(edges[0]).toMatchObject({
      source: 'blockchain-node-1',
      target: 'blockchain-node-2',
      animated: true,
    });
  });

  it('emits no edge for a root (previousNode 0 or empty)', () => {
    const { edges } = build(chain(1));
    expect(edges).toEqual([]);
  });

  it('positions nodes from the tree layout', () => {
    const gd = chain(2);
    const layout = calculateTreeLayout(gd.nodeIds, gd.previousNodes, TIMELINE_LAYOUT_CONFIG);
    const { nodes } = buildSceneFlowGraph({
      graphData: gd,
      layout,
      archivedNodeIds: new Set(),
      localEvents: {},
      universeId: '0xuni',
    });
    expect(nodes[0].position).toEqual(layout.nodePositions.get(1));
    expect(nodes[1].position).toEqual(layout.nodePositions.get(2));
  });

  it('stamps universeId onto every node', () => {
    const { nodes } = build(chain(2), { universeId: '0xdeadbeef' });
    expect(nodes.every((n) => n.data.universeId === '0xdeadbeef')).toBe(true);
  });

  it('leaves the action callbacks off — the component attaches them', () => {
    const { nodes } = build(chain(1));
    expect(nodes[0].data.onAddScene).toBeUndefined();
    expect(nodes[0].data.onEditScene).toBeUndefined();
    expect(nodes[0].data.isSelected).toBe(false);
  });
});

describe('buildTimelineFlowGraph — archived nodes', () => {
  it('skips an archived node from the node list', () => {
    const { nodes } = build(chain(3), { archivedNodeIds: new Set(['2']) });
    expect(nodes.map((n) => n.id)).toEqual(['blockchain-node-1', 'blockchain-node-3']);
  });

  it('still emits the edges that referenced the archived node (dangling — matches current behaviour)', () => {
    const { edges } = build(chain(3), { archivedNodeIds: new Set(['2']) });
    expect(edges.map((e) => e.id)).toEqual(['edge-1-2', 'edge-2-3']);
  });
});

describe('buildTimelineFlowGraph — videoUrl resolution', () => {
  it('passes a real URL through', () => {
    const { nodes } = build(chain(1, { urls: ['https://cdn/1.mp4'] }));
    expect(nodes[0].data.videoUrl).toBe('https://cdn/1.mp4');
  });

  it('strips a bytes32 hash placeholder to an empty string', () => {
    const { nodes } = build(chain(1, { urls: [HASH] }));
    expect(nodes[0].data.videoUrl).toBe('');
  });

  it('prefers a locally-saved videoUrl over graphData', () => {
    const { nodes } = build(chain(1, { urls: ['https://cdn/onchain.mp4'] }), {
      localEvents: { '1': { videoUrl: 'https://local/edit.mp4' } },
    });
    expect(nodes[0].data.videoUrl).toBe('https://local/edit.mp4');
  });
});

describe('buildTimelineFlowGraph — description + label', () => {
  it('unwraps a {timestamp, description} object', () => {
    const { nodes } = build(chain(1, { descriptions: [{ description: 'wrapped text' } as any] }));
    expect(nodes[0].data.description).toBe('wrapped text');
  });

  it('blanks a bytes32-hash description and falls back to "Event <id>"', () => {
    const { nodes } = build(chain(1, { descriptions: [HASH] }));
    expect(nodes[0].data.description).toBe('Event 1');
    expect(nodes[0].data.label).toBe('Event 1');
  });

  it('uses a locally-saved title as the label', () => {
    const { nodes } = build(chain(1, { descriptions: ['some plot'] }), {
      localEvents: { '1': { title: 'The Morning Prayer' } },
    });
    expect(nodes[0].data.label).toBe('The Morning Prayer');
  });

  it('truncates a long description to 50 chars + ellipsis for the label', () => {
    const long = 'x'.repeat(80);
    const { nodes } = build(chain(1, { descriptions: [long] }));
    expect(nodes[0].data.label).toBe('x'.repeat(50) + '...');
    expect(nodes[0].data.description).toBe(long);
  });

  it('treats the "Timeline event <id>" sentinel as no description', () => {
    const { nodes } = build(chain(1, { descriptions: ['Timeline event 1'] }));
    expect(nodes[0].data.label).toBe('Event 1');
  });
});

describe('buildTimelineFlowGraph — flags derived onto node data', () => {
  it('marks isRoot for previousNode 0 / empty only', () => {
    const gd = chain(2);
    const { nodes } = build(gd);
    expect(nodes[0].data.isRoot).toBe(true);
    expect(nodes[1].data.isRoot).toBe(false);
  });

  it('marks isInCanonChain from the canon chain membership', () => {
    const { nodes } = build(chain(3, { canonChain: [1, 3] }));
    expect(nodes.map((n) => n.data.isInCanonChain)).toEqual([true, false, true]);
  });

  it('only surfaces segmentCount when it is > 1', () => {
    const seg = build(chain(2), { getSegmentCount: (id) => (id === 1 ? 3 : 1) });
    expect(seg.nodes[0].data.segmentCount).toBe(3);
    expect(seg.nodes[1].data.segmentCount).toBeUndefined();
  });

  it('only surfaces childCount when a node has more than one child', () => {
    // node 1 -> [2, 3]; node 2 -> []; node 3 -> []
    const gd: GraphData = {
      ...EMPTY_GRAPH_DATA,
      nodeIds: [1, 2, 3],
      urls: ['', '', ''],
      descriptions: ['', '', ''],
      previousNodes: [0, 1, 1],
      children: [[2, 3], [], []],
      flags: [false, false, false],
    };
    const { nodes } = build(gd);
    expect(nodes[0].data.childCount).toBe(2);
    expect(nodes[1].data.childCount).toBeUndefined();
  });

  it('maps localEvent.videoVersions into node data', () => {
    const { nodes } = build(chain(1), {
      localEvents: {
        '1': {
          videoVersions: [{ videoUrl: 'v1', versionNumber: 1, generatedAt: 't', model: 'm' }],
          currentVersionIndex: 0,
        },
      },
    });
    expect(nodes[0].data.videoVersions).toEqual([
      { videoUrl: 'v1', versionNumber: 1, generatedAt: 't', model: 'm' },
    ]);
    expect(nodes[0].data.currentVersionIndex).toBe(0);
  });
});

describe('buildTimelineFlowGraph — colours + edge styling', () => {
  it('uses the canon colour (index 0) for canon nodes, cycling the rest', () => {
    const { nodes } = build(chain(3, { flags: [true, false, false] }));
    expect(nodes[0].data.timelineColor).toBe(TIMELINE_NODE_COLORS[0]);
    expect(nodes[1].data.timelineColor).toBe(TIMELINE_NODE_COLORS[2 % TIMELINE_NODE_COLORS.length]);
  });

  it('labels a canon edge "Canon" with a thick yellow stroke', () => {
    const { edges } = build(chain(2, { flags: [false, true] }));
    expect(edges[0].label).toBe('Canon');
    expect(edges[0].style).toMatchObject({ strokeWidth: 3 });
    expect((edges[0].labelStyle as any).fill).toBe('#eab308');
  });

  it('labels a non-first child of a multi-child parent "Branch"', () => {
    // 1 -> [2, 3]; edge 1->3 is the branch
    const gd: GraphData = {
      ...EMPTY_GRAPH_DATA,
      nodeIds: [1, 2, 3],
      urls: ['', '', ''],
      descriptions: ['', '', ''],
      previousNodes: [0, 1, 1],
      children: [[2, 3], [], []],
      flags: [false, false, false],
    };
    const { edges } = build(gd);
    const byId = Object.fromEntries(edges.map((e) => [e.id, e]));
    expect(byId['edge-1-2'].label).toBeUndefined(); // first child = main line
    expect(byId['edge-1-3'].label).toBe('Branch');
  });

  it('leaves a plain linear edge unlabelled with a 2px stroke', () => {
    const { edges } = build(chain(2));
    expect(edges[0].label).toBeUndefined();
    expect(edges[0].style).toMatchObject({ strokeWidth: 2 });
  });
});

describe('buildTimelineFlowGraph — empty', () => {
  it('returns empty nodes/edges for an empty graph', () => {
    expect(build(EMPTY_GRAPH_DATA)).toEqual({ nodes: [], edges: [] });
  });
});

// ── mergeDraftNodes ──────────────────────────────────────────────────────

const sceneNode = (id: string, x = 100, y = 100): Node<TimelineNodeData> => ({
  id,
  type: 'timelineEvent',
  position: { x, y },
  data: { nodeType: 'scene', label: id, description: '' } as TimelineNodeData,
});

const mergeDrafts = (
  localEvents: Record<string, any>,
  over: Partial<Parameters<typeof mergeDraftNodes>[0]> = {}
) =>
  mergeDraftNodes({
    nodes: [sceneNode('blockchain-node-1', 100, 100)],
    edges: [] as Edge[],
    localEvents,
    onChainNodeIds: new Set(['1']),
    universeId: '0xuni',
    timelineId: 'timeline-0xuni',
    ...over,
  });

describe('mergeDraftNodes', () => {
  it('no drafts → returns copies of the inputs, unchanged', () => {
    const nodes = [sceneNode('blockchain-node-1')];
    const edges: Edge[] = [];
    const out = mergeDraftNodes({
      nodes,
      edges,
      localEvents: {},
      onChainNodeIds: new Set(['1']),
      universeId: '0xuni',
      timelineId: 't',
    });
    expect(out.nodes).toEqual(nodes);
    expect(out.nodes).not.toBe(nodes); // fresh array
    expect(out.edges).toEqual([]);
  });

  it('appends a draft as a purple isDraft scene node keyed by its localEvents id', () => {
    const { nodes } = mergeDrafts({
      'draft-a': { videoUrl: 'https://v/a.mp4', title: 'Fresh Clip', timestamp: 1 },
    });
    const draft = nodes.find((n) => n.id === 'draft-a')!;
    expect(draft).toBeDefined();
    expect(draft.data).toMatchObject({
      nodeType: 'scene',
      isDraft: true,
      label: 'Fresh Clip',
      videoUrl: 'https://v/a.mp4',
      timelineColor: '#a855f7',
      timelineId: 'timeline-0xuni',
      universeId: '0xuni',
    });
  });

  it('labels a title-less draft "Untitled scene" and blanks a missing description', () => {
    const { nodes } = mergeDrafts({ d: { videoUrl: 'https://v.mp4', timestamp: 1 } });
    const d = nodes.find((n) => n.id === 'd')!;
    expect(d.data.label).toBe('Untitled scene');
    expect(d.data.description).toBe('');
  });

  it('skips a localEvents entry with no videoUrl', () => {
    const { nodes } = mergeDrafts({ d: { title: 'no video', timestamp: 1 } });
    expect(nodes.some((n) => n.id === 'd')).toBe(false);
  });

  it('skips an entry whose id is already on-chain', () => {
    const { nodes } = mergeDrafts(
      { '1': { videoUrl: 'https://v.mp4', timestamp: 1 } },
      { onChainNodeIds: new Set(['1']) }
    );
    expect(nodes).toHaveLength(1); // just the original scene node
  });

  it('orders multiple drafts by timestamp', () => {
    const { nodes } = mergeDrafts({
      late: { videoUrl: 'https://l.mp4', timestamp: 200 },
      early: { videoUrl: 'https://e.mp4', timestamp: 100 },
    });
    const ids = nodes.map((n) => n.id);
    expect(ids.indexOf('early')).toBeLessThan(ids.indexOf('late'));
  });

  it('chains the first draft off the current tail with a dashed purple edge', () => {
    const { edges } = mergeDrafts({ d: { videoUrl: 'https://v.mp4', timestamp: 1 } });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: 'edge-blockchain-node-1-d',
      source: 'blockchain-node-1',
      target: 'd',
    });
    expect((edges[0].style as any).strokeDasharray).toBe('4,4');
  });

  it('chains consecutive drafts off each other', () => {
    const { edges } = mergeDrafts({
      a: { videoUrl: 'https://a.mp4', timestamp: 1 },
      b: { videoUrl: 'https://b.mp4', timestamp: 2 },
    });
    expect(edges.map((e) => e.id)).toEqual(['edge-blockchain-node-1-a', 'edge-a-b']);
  });

  it('routes a draft to an explicit on-chain sourceNodeId as blockchain-node-<n>', () => {
    const { edges } = mergeDrafts({
      d: { videoUrl: 'https://v.mp4', timestamp: 1, sourceNodeId: '1' },
    });
    expect(edges[0].source).toBe('blockchain-node-1');
  });

  it('routes a draft to an explicit off-chain (draft) sourceNodeId verbatim', () => {
    const { edges } = mergeDrafts({
      d: { videoUrl: 'https://v.mp4', timestamp: 1, sourceNodeId: 'some-other-draft' },
    });
    expect(edges[0].source).toBe('some-other-draft');
  });

  it('places a draft at ev.position when given, else 420px right of the tail', () => {
    const withPos = mergeDrafts({
      d: { videoUrl: 'https://v.mp4', timestamp: 1, position: { x: 5, y: 6 } },
    });
    expect(withPos.nodes.find((n) => n.id === 'd')!.position).toEqual({ x: 5, y: 6 });

    const noPos = mergeDrafts({ d: { videoUrl: 'https://v.mp4', timestamp: 1 } });
    expect(noPos.nodes.find((n) => n.id === 'd')!.position).toEqual({ x: 520, y: 100 });
  });

  it('with an empty starting graph, the sole draft gets no edge (no tail to attach to)', () => {
    const out = mergeDraftNodes({
      nodes: [],
      edges: [],
      localEvents: { d: { videoUrl: 'https://v.mp4', timestamp: 1 } },
      onChainNodeIds: new Set(),
      universeId: '0xuni',
      timelineId: 't',
    });
    expect(out.nodes).toHaveLength(1);
    expect(out.edges).toEqual([]);
    expect(out.nodes[0].position).toEqual({ x: 520, y: 100 });
  });

  it('does not mutate the input arrays', () => {
    const nodes = [sceneNode('blockchain-node-1')];
    const edges: Edge[] = [];
    mergeDraftNodes({
      nodes,
      edges,
      localEvents: { d: { videoUrl: 'https://v.mp4', timestamp: 1 } },
      onChainNodeIds: new Set(),
      universeId: '0xuni',
      timelineId: 't',
    });
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
  });
});

// ── appendAddFinalNode ───────────────────────────────────────────────────

describe('appendAddFinalNode', () => {
  it('is a no-op on an empty graph (returns fresh empty arrays)', () => {
    const out = appendAddFinalNode({ nodes: [], edges: [] });
    expect(out).toEqual({ nodes: [], edges: [] });
  });

  it('adds an "add-final" node 420px right of the last node, plus a dashed connector', () => {
    const { nodes, edges } = appendAddFinalNode({
      nodes: [sceneNode('blockchain-node-3', 900, 200)],
      edges: [],
    });
    const add = nodes.find((n) => n.id === 'add-final')!;
    expect(add.data.nodeType).toBe('add');
    expect(add.position).toEqual({ x: 1320, y: 200 });
    expect(edges).toEqual([
      expect.objectContaining({
        id: 'edge-blockchain-node-3-add-final',
        source: 'blockchain-node-3',
        target: 'add-final',
      }),
    ]);
    expect((edges[0].style as any).strokeDasharray).toBe('8,8');
  });

  it('anchors to whatever node is last (e.g. a draft)', () => {
    const { nodes } = appendAddFinalNode({
      nodes: [sceneNode('blockchain-node-1', 100, 100), sceneNode('draft-x', 520, 100)],
      edges: [],
    });
    expect(nodes.find((n) => n.id === 'add-final')!.position).toEqual({ x: 940, y: 100 });
  });

  it('does not mutate the input', () => {
    const input = { nodes: [sceneNode('n1')], edges: [] as Edge[] };
    appendAddFinalNode(input);
    expect(input.nodes).toHaveLength(1);
    expect(input.edges).toHaveLength(0);
  });
});

describe('draft merge + add node — full pipeline parity', () => {
  it('scene nodes, then timestamp-ordered drafts, then the add node', () => {
    const scene = build(chain(2));
    const withDrafts = mergeDraftNodes({
      nodes: scene.nodes,
      edges: scene.edges,
      localEvents: { d1: { videoUrl: 'https://d1.mp4', timestamp: 10 } },
      onChainNodeIds: new Set(['1', '2']),
      universeId: '0xuni',
      timelineId: 'timeline-0xuni',
    });
    const final = appendAddFinalNode(withDrafts);
    expect(final.nodes.map((n) => n.id)).toEqual([
      'blockchain-node-1',
      'blockchain-node-2',
      'd1',
      'add-final',
    ]);
    expect(final.nodes.at(-1)!.data.nodeType).toBe('add');
  });
});

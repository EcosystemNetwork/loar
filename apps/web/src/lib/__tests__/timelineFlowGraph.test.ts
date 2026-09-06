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
import {
  TIMELINE_LAYOUT_CONFIG,
  TIMELINE_NODE_COLORS,
  buildSceneFlowGraph,
  buildTimelineFlowGraph,
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

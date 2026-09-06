/**
 * Unit tests for universeGraphData.ts — the pure on-chain/off-chain merge
 * behind useUniverseBlockchain's `graphData`. This is the layer that feeds
 * the timeline editor, the branching player, and the per-event pages, so
 * its edge cases (hidden-media overrides, the "never blank the graph"
 * guard, URL/description precedence) are pinned down here rather than only
 * exercised through the full React tree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_GRAPH_DATA,
  buildGraphData,
  buildOffChainGraphData,
  buildOnChainGraphData,
  type IndexerNodeContent,
  type NodeMediaOverride,
  type RawFullGraph,
} from '../universeGraphData';

const HASH_A = '0x' + 'a'.repeat(64);
const HASH_B = '0x' + 'b'.repeat(64);
const HASH_C = '0x' + 'c'.repeat(64);
const PLOT_A = '0x' + '1'.repeat(64);
const PLOT_B = '0x' + '2'.repeat(64);
const PLOT_C = '0x' + '3'.repeat(64);

/** [nodeIds, contentHashes, plotHashes, previousIds, nextIds, flags] */
function fullGraph(
  nodeIds: (string | number | bigint)[],
  opts: Partial<{
    contentHashes: string[];
    plotHashes: string[];
    previousIds: (string | number | bigint)[];
    nextIds: (string | number | bigint)[][];
    flags: boolean[];
  }> = {}
): RawFullGraph {
  return [
    nodeIds,
    opts.contentHashes ?? nodeIds.map(() => ''),
    opts.plotHashes ?? nodeIds.map(() => ''),
    opts.previousIds ?? nodeIds.map((_, i) => (i === 0 ? 0 : nodeIds[i - 1])),
    opts.nextIds ?? nodeIds.map(() => []),
    opts.flags ?? nodeIds.map(() => false),
  ];
}

function content(
  entries: Record<string, Partial<IndexerNodeContent>>
): Map<string, IndexerNodeContent> {
  const m = new Map<string, IndexerNodeContent>();
  for (const [id, v] of Object.entries(entries)) {
    m.set(id, {
      id: `0xuniverse:${id}`,
      contentHash: '',
      plotHash: '',
      videoLink: '',
      plot: '',
      ...v,
    });
  }
  return m;
}

afterEach(() => vi.restoreAllMocks());

describe('buildOffChainGraphData', () => {
  it('returns the shared EMPTY_GRAPH_DATA for undefined / empty input', () => {
    expect(buildOffChainGraphData(undefined)).toBe(EMPTY_GRAPH_DATA);
    expect(buildOffChainGraphData([])).toBe(EMPTY_GRAPH_DATA);
  });

  it('maps Firestore offChainNodes docs into parallel GraphData arrays', () => {
    const g = buildOffChainGraphData([
      {
        nodeId: 86,
        contentHash: HASH_A,
        plotHash: PLOT_A,
        videoUrl: 'https://cdn/x.mp4',
        title: 'The Morning Prayer',
        previousNodeId: 0,
        children: [87],
        canon: true,
      },
      {
        nodeId: 87,
        videoUrl: 'https://cdn/y.mp4',
        plot: 'a long plot string',
        previousNodeId: 86,
        children: [],
        canon: false,
      },
    ]);

    expect(g.nodeIds).toEqual(['86', '87']);
    expect(g.contentHashes).toEqual([HASH_A, '']);
    expect(g.plotHashes).toEqual([PLOT_A, '']);
    expect(g.urls).toEqual(['https://cdn/x.mp4', 'https://cdn/y.mp4']);
    // description prefers title, falls back to plot
    expect(g.descriptions).toEqual(['The Morning Prayer', 'a long plot string']);
    expect(g.previousNodes).toEqual(['0', '86']);
    expect(g.children).toEqual([['87'], []]);
    expect(g.flags).toEqual([true, false]);
    expect(g.canonChain).toEqual(['86']);
  });

  it('defaults missing videoUrl / hashes / title+plot to empty strings', () => {
    const g = buildOffChainGraphData([{ nodeId: 1, previousNodeId: 0 }]);
    expect(g.urls).toEqual(['']);
    expect(g.contentHashes).toEqual(['']);
    expect(g.descriptions).toEqual(['']);
    expect(g.previousNodes).toEqual(['0']);
  });

  it('coerces a non-array children field to []', () => {
    const g = buildOffChainGraphData([
      { nodeId: 1, children: undefined },
      { nodeId: 2, children: null },
    ]);
    expect(g.children).toEqual([[], []]);
  });

  it('stringifies numeric children ids', () => {
    const g = buildOffChainGraphData([{ nodeId: 1, children: [2, 3, 4] }]);
    expect(g.children).toEqual([['2', '3', '4']]);
  });
});

describe('buildOnChainGraphData — content resolution', () => {
  it('with no indexer content and no overrides, urls/descriptions fall back to the on-chain bytes32 hashes', () => {
    const g = buildOnChainGraphData(
      fullGraph([1, 2], { contentHashes: [HASH_A, HASH_B], plotHashes: [PLOT_A, PLOT_B] }),
      [],
      undefined,
      undefined
    );
    expect(g.urls).toEqual([HASH_A, HASH_B]);
    expect(g.descriptions).toEqual([PLOT_A, PLOT_B]);
    expect(g.contentHashes).toEqual([HASH_A, HASH_B]);
    expect(g.plotHashes).toEqual([PLOT_A, PLOT_B]);
  });

  it('prefers indexer videoLink / plot over the on-chain hash', () => {
    const g = buildOnChainGraphData(
      fullGraph([1], { contentHashes: [HASH_A], plotHashes: [PLOT_A] }),
      [],
      content({ '1': { videoLink: 'https://ipfs/clip.mp4', plot: 'real plot' } }),
      undefined
    );
    expect(g.urls).toEqual(['https://ipfs/clip.mp4']);
    expect(g.descriptions).toEqual(['real plot']);
  });

  it('prefers an off-chain media override videoLink over both indexer and hash', () => {
    const g = buildOnChainGraphData(
      fullGraph([1], { contentHashes: [HASH_A] }),
      [],
      content({ '1': { videoLink: 'https://ipfs/indexer.mp4' } }),
      { 1: { videoLink: 'https://cdn/override.mp4' } }
    );
    expect(g.urls).toEqual(['https://cdn/override.mp4']);
  });

  it('override only carries a URL — description still comes from the indexer', () => {
    const g = buildOnChainGraphData(
      fullGraph([1], { plotHashes: [PLOT_A] }),
      [],
      content({ '1': { plot: 'indexed plot' } }),
      { 1: { videoLink: 'https://cdn/override.mp4' } }
    );
    expect(g.urls).toEqual(['https://cdn/override.mp4']);
    expect(g.descriptions).toEqual(['indexed plot']);
  });

  it('coerces flags to real booleans', () => {
    const g = buildOnChainGraphData(
      fullGraph([1, 2, 3], { flags: [true, false, undefined as any] }),
      [],
      undefined,
      undefined
    );
    expect(g.flags).toEqual([true, false, false]);
  });

  it('returns empty parallel arrays when the tuple entries are all undefined', () => {
    const g = buildOnChainGraphData(
      [undefined, undefined, undefined, undefined, undefined, undefined],
      undefined,
      undefined,
      undefined
    );
    expect(g).toEqual(EMPTY_GRAPH_DATA);
  });
});

describe('buildOnChainGraphData — hidden media overrides', () => {
  const base = () =>
    fullGraph([1, 2, 3], {
      contentHashes: [HASH_A, HASH_B, HASH_C],
      plotHashes: [PLOT_A, PLOT_B, PLOT_C],
      previousIds: [0, 1, 2],
      nextIds: [[2], [3], []],
      flags: [true, true, true],
    });

  it('drops a hidden node from every parallel array', () => {
    const g = buildOnChainGraphData(base(), [1, 2, 3], undefined, { 2: { hidden: true } });
    expect(g.nodeIds).toEqual([1, 3]);
    expect(g.contentHashes).toEqual([HASH_A, HASH_C]);
    expect(g.urls).toEqual([HASH_A, HASH_C]);
    expect(g.flags).toEqual([true, true]);
  });

  it("clears a surviving node's previousNodes pointer when its parent was hidden", () => {
    // 3's parent is 2, and 2 is hidden -> 3 should render as a root ('')
    const g = buildOnChainGraphData(base(), [], undefined, { 2: { hidden: true } });
    expect(g.nodeIds).toEqual([1, 3]);
    expect(g.previousNodes).toEqual([0, '']);
  });

  it("strips a hidden id out of other nodes' children lists", () => {
    // 1's children = [2]; 2 hidden -> 1's children becomes []
    const g = buildOnChainGraphData(base(), [], undefined, { 2: { hidden: true } });
    expect(g.children[0]).toEqual([]);
  });

  it('removes hidden ids from the canon chain', () => {
    const g = buildOnChainGraphData(base(), [1, 2, 3], undefined, { 2: { hidden: true } });
    expect(g.canonChain).toEqual([1, 3]);
  });

  it('ignores the hidden set entirely when it would hide every node, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = buildOnChainGraphData(base(), [1, 2, 3], undefined, {
      1: { hidden: true },
      2: { hidden: true },
      3: { hidden: true },
    });
    expect(g.nodeIds).toEqual([1, 2, 3]);
    expect(g.previousNodes).toEqual([0, 1, 2]);
    expect(g.canonChain).toEqual([1, 2, 3]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('a non-hidden override (URL only) does not drop the node', () => {
    const g = buildOnChainGraphData(base(), [], undefined, {
      2: { videoLink: 'https://cdn/2.mp4' },
    });
    expect(g.nodeIds).toEqual([1, 2, 3]);
    expect(g.urls[1]).toBe('https://cdn/2.mp4');
  });
});

describe('buildGraphData — strict on-chain vs off-chain routing', () => {
  const tuple = fullGraph([1, 2], { contentHashes: [HASH_A, HASH_B] });
  const offNodes = [{ nodeId: 9, videoUrl: 'https://off/9.mp4', previousNodeId: 0, canon: true }];

  it('on-chain mode with a contract address and graph data → merged on-chain result', () => {
    const g = buildGraphData({
      useOnChain: true,
      onChainContractAddress: '0xabc',
      fullGraphData: tuple,
      offChainNodes: offNodes,
    });
    expect(g.nodeIds).toEqual([1, 2]);
  });

  it('on-chain mode without a contract address → EMPTY (never falls back to off-chain)', () => {
    const g = buildGraphData({
      useOnChain: true,
      onChainContractAddress: undefined,
      fullGraphData: tuple,
      offChainNodes: offNodes,
    });
    expect(g).toBe(EMPTY_GRAPH_DATA);
  });

  it('on-chain mode with an address but no graph data yet → EMPTY', () => {
    const g = buildGraphData({
      useOnChain: true,
      onChainContractAddress: '0xabc',
      fullGraphData: undefined,
      offChainNodes: offNodes,
    });
    expect(g).toBe(EMPTY_GRAPH_DATA);
  });

  it('off-chain mode → off-chain result, ignoring any on-chain inputs', () => {
    const g = buildGraphData({
      useOnChain: false,
      onChainContractAddress: '0xabc',
      fullGraphData: tuple,
      offChainNodes: offNodes,
    });
    expect(g.nodeIds).toEqual(['9']);
    expect(g.urls).toEqual(['https://off/9.mp4']);
  });

  it('off-chain mode with no nodes → EMPTY', () => {
    const g = buildGraphData({ useOnChain: false, offChainNodes: undefined });
    expect(g).toBe(EMPTY_GRAPH_DATA);
  });
});

describe('EMPTY_GRAPH_DATA', () => {
  it('is frozen and has every GraphData key as an empty array', () => {
    expect(Object.isFrozen(EMPTY_GRAPH_DATA)).toBe(true);
    for (const k of [
      'nodeIds',
      'contentHashes',
      'plotHashes',
      'urls',
      'descriptions',
      'previousNodes',
      'children',
      'flags',
      'canonChain',
    ] as const) {
      expect(EMPTY_GRAPH_DATA[k]).toEqual([]);
    }
  });
});

/**
 * Unit tests for the pure node-filter predicate in flow/types.ts
 * (isFilterActive + nodeMatchesFilter), which drives the universe timeline
 * editor's dim-non-matching-nodes behaviour via useNodeFilter.
 */
import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import type { TimelineNodeData } from '../TimelineNodes';
import {
  DEFAULT_FILTER,
  type ArcDefinition,
  type NodeFilter,
  isFilterActive,
  nodeMatchesFilter,
} from '../types';

function sceneNode(over: Partial<TimelineNodeData> & { id?: string } = {}): Node<TimelineNodeData> {
  const { id = 'n1', ...data } = over;
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      label: 'Scene',
      description: '',
      nodeType: 'scene',
      ...data,
    } as TimelineNodeData,
  } as Node<TimelineNodeData>;
}

const filter = (over: Partial<NodeFilter> = {}): NodeFilter => ({ ...DEFAULT_FILTER, ...over });

describe('isFilterActive', () => {
  it('is false for the default filter', () => {
    expect(isFilterActive(DEFAULT_FILTER)).toBe(false);
  });

  it('is false when searchText is only whitespace', () => {
    expect(isFilterActive(filter({ searchText: '   ' }))).toBe(false);
  });

  it('is true when any facet is set', () => {
    expect(isFilterActive(filter({ searchText: 'a' }))).toBe(true);
    expect(isFilterActive(filter({ canonStatus: 'canon' }))).toBe(true);
    expect(isFilterActive(filter({ canonStatus: 'non-canon' }))).toBe(true);
    expect(isFilterActive(filter({ arcId: 'arc-1' }))).toBe(true);
    expect(isFilterActive(filter({ hasVideo: 'yes' }))).toBe(true);
    expect(isFilterActive(filter({ hasVideo: 'no' }))).toBe(true);
  });
});

describe('nodeMatchesFilter — non-scene nodes', () => {
  it('always pass, regardless of the filter', () => {
    const add = {
      id: 'a',
      position: { x: 0, y: 0 },
      data: { nodeType: 'add' },
    } as Node<TimelineNodeData>;
    expect(nodeMatchesFilter(add, filter({ searchText: 'nope', hasVideo: 'yes' }), [])).toBe(true);
  });
});

describe('nodeMatchesFilter — text search', () => {
  it('passes when the query is empty', () => {
    expect(nodeMatchesFilter(sceneNode({ label: 'anything' }), DEFAULT_FILTER, [])).toBe(true);
  });

  it('matches against label, description, eventId and displayName, case-insensitively', () => {
    expect(
      nodeMatchesFilter(
        sceneNode({ label: 'The Morning Prayer' }),
        filter({ searchText: 'morning' }),
        []
      )
    ).toBe(true);
    expect(
      nodeMatchesFilter(
        sceneNode({ label: 'x', description: 'a CATHEDRAL scene' }),
        filter({ searchText: 'cathedral' }),
        []
      )
    ).toBe(true);
    expect(
      nodeMatchesFilter(sceneNode({ eventId: '146' }), filter({ searchText: '146' }), [])
    ).toBe(true);
    expect(
      nodeMatchesFilter(sceneNode({ displayName: 'AXIOM-7' }), filter({ searchText: 'axiom' }), [])
    ).toBe(true);
  });

  it('fails when the query is nowhere in the haystack', () => {
    expect(
      nodeMatchesFilter(
        sceneNode({ label: 'The Morning Prayer' }),
        filter({ searchText: 'zzz' }),
        []
      )
    ).toBe(false);
  });

  it('trims surrounding whitespace on the query before matching', () => {
    // regression: a trailing space used to zero out all results
    expect(
      nodeMatchesFilter(
        sceneNode({ label: 'Herald Prime' }),
        filter({ searchText: '  herald ' }),
        []
      )
    ).toBe(true);
  });
});

describe('nodeMatchesFilter — canon status', () => {
  it('"canon" keeps only nodes in the canon chain', () => {
    expect(
      nodeMatchesFilter(sceneNode({ isInCanonChain: true }), filter({ canonStatus: 'canon' }), [])
    ).toBe(true);
    expect(
      nodeMatchesFilter(sceneNode({ isInCanonChain: false }), filter({ canonStatus: 'canon' }), [])
    ).toBe(false);
  });

  it('"non-canon" is the inverse', () => {
    expect(
      nodeMatchesFilter(
        sceneNode({ isInCanonChain: false }),
        filter({ canonStatus: 'non-canon' }),
        []
      )
    ).toBe(true);
    expect(
      nodeMatchesFilter(
        sceneNode({ isInCanonChain: true }),
        filter({ canonStatus: 'non-canon' }),
        []
      )
    ).toBe(false);
  });

  it('"all" keeps both', () => {
    expect(nodeMatchesFilter(sceneNode({ isInCanonChain: true }), DEFAULT_FILTER, [])).toBe(true);
    expect(nodeMatchesFilter(sceneNode({ isInCanonChain: false }), DEFAULT_FILTER, [])).toBe(true);
  });
});

describe('nodeMatchesFilter — has video', () => {
  it('"yes" keeps only nodes with a videoUrl', () => {
    expect(
      nodeMatchesFilter(sceneNode({ videoUrl: 'https://x.mp4' }), filter({ hasVideo: 'yes' }), [])
    ).toBe(true);
    expect(nodeMatchesFilter(sceneNode({ videoUrl: '' }), filter({ hasVideo: 'yes' }), [])).toBe(
      false
    );
    expect(nodeMatchesFilter(sceneNode({}), filter({ hasVideo: 'yes' }), [])).toBe(false);
  });

  it('"no" keeps only nodes without one', () => {
    expect(nodeMatchesFilter(sceneNode({}), filter({ hasVideo: 'no' }), [])).toBe(true);
    expect(
      nodeMatchesFilter(sceneNode({ videoUrl: 'https://x.mp4' }), filter({ hasVideo: 'no' }), [])
    ).toBe(false);
  });
});

describe('nodeMatchesFilter — arc membership', () => {
  const arcs: ArcDefinition[] = [
    { id: 'arc-1', name: 'Act I', color: '#f00', nodeIds: ['n1', 'n2'] },
  ];

  it('keeps a node that belongs to the selected arc', () => {
    expect(nodeMatchesFilter(sceneNode({ id: 'n1' }), filter({ arcId: 'arc-1' }), arcs)).toBe(true);
  });

  it('drops a node that is not in the selected arc', () => {
    expect(nodeMatchesFilter(sceneNode({ id: 'n9' }), filter({ arcId: 'arc-1' }), arcs)).toBe(
      false
    );
  });

  it('ignores an arcId that matches no known arc (no constraint applied)', () => {
    expect(nodeMatchesFilter(sceneNode({ id: 'n9' }), filter({ arcId: 'ghost' }), arcs)).toBe(true);
  });
});

describe('nodeMatchesFilter — facets combine with AND', () => {
  it('a node must satisfy every active facet', () => {
    const n = sceneNode({
      id: 'n1',
      label: 'Herald',
      isInCanonChain: true,
      videoUrl: 'https://v.mp4',
    });
    const arcs: ArcDefinition[] = [{ id: 'arc-1', name: 'A', color: '#0f0', nodeIds: ['n1'] }];
    expect(
      nodeMatchesFilter(
        n,
        filter({ searchText: 'herald', canonStatus: 'canon', hasVideo: 'yes', arcId: 'arc-1' }),
        arcs
      )
    ).toBe(true);
    // flip one facet the node fails
    expect(
      nodeMatchesFilter(n, filter({ searchText: 'herald', canonStatus: 'non-canon' }), arcs)
    ).toBe(false);
  });
});

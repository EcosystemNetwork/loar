/**
 * Unit tests for flow/selection.ts — the timeline editor's
 * multi-selection → ordered clip list / swap-eligibility helpers.
 */
import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import type { TimelineNodeData } from '../TimelineNodes';
import {
  ROW_BAND_PX,
  canSwapOnChain,
  compareByCanvasFlow,
  nodeDisplayTitle,
  selectedVideoScenesInFlowOrder,
} from '../selection';

function n(
  id: string,
  opts: {
    x?: number;
    y?: number;
    videoUrl?: string;
    nodeType?: TimelineNodeData['nodeType'];
    blockchainNodeId?: number;
    label?: string;
    displayName?: string;
    eventId?: string;
  } = {}
): Node<TimelineNodeData> {
  const { x = 0, y = 0, ...data } = opts;
  return {
    id,
    position: { x, y },
    data: { nodeType: 'scene', ...data } as TimelineNodeData,
  } as Node<TimelineNodeData>;
}

describe('compareByCanvasFlow', () => {
  it('sorts by x within the same row (y within the band)', () => {
    expect(
      compareByCanvasFlow(n('a', { x: 300, y: 10 }), n('b', { x: 100, y: 40 }))
    ).toBeGreaterThan(0);
  });

  it('sorts by y across rows (y gap beyond the band)', () => {
    expect(compareByCanvasFlow(n('a', { x: 999, y: 0 }), n('b', { x: 0, y: 200 }))).toBeLessThan(0);
  });

  it(`treats an exactly-${ROW_BAND_PX}px y gap as the same row (x decides)`, () => {
    const a = n('a', { x: 500, y: 0 });
    const b = n('b', { x: 100, y: ROW_BAND_PX });
    expect(compareByCanvasFlow(a, b)).toBe(400); // x difference, not y
  });

  it('returns 0 for identical positions', () => {
    expect(compareByCanvasFlow(n('a', { x: 5, y: 5 }), n('b', { x: 5, y: 5 }))).toBe(0);
  });

  it('orders a grid row-major', () => {
    const nodes = [
      n('br', { x: 400, y: 300 }),
      n('tl', { x: 0, y: 0 }),
      n('bl', { x: 0, y: 300 }),
      n('tr', { x: 400, y: 0 }),
    ];
    expect([...nodes].sort(compareByCanvasFlow).map((x) => x.id)).toEqual(['tl', 'tr', 'bl', 'br']);
  });
});

describe('selectedVideoScenesInFlowOrder', () => {
  const nodes = [
    n('s2', { x: 400, y: 0, videoUrl: 'https://2.mp4' }),
    n('s1', { x: 0, y: 0, videoUrl: 'https://1.mp4' }),
    n('s3-novideo', { x: 800, y: 0 }),
    n('add', { x: 1200, y: 0, videoUrl: 'https://x.mp4', nodeType: 'add' }),
    n('s4-unselected', { x: 0, y: 300, videoUrl: 'https://4.mp4' }),
  ];

  it('returns [] for an empty selection', () => {
    expect(selectedVideoScenesInFlowOrder(nodes, new Set())).toEqual([]);
  });

  it('keeps only selected scene nodes that have a videoUrl, in canvas order', () => {
    const out = selectedVideoScenesInFlowOrder(nodes, new Set(['s1', 's2', 's3-novideo', 'add']));
    expect(out.map((x) => x.id)).toEqual(['s1', 's2']); // no-video and add dropped, x-ordered
  });

  it('excludes nodes that are not in the selection', () => {
    const out = selectedVideoScenesInFlowOrder(nodes, new Set(['s1']));
    expect(out.map((x) => x.id)).toEqual(['s1']);
  });

  it('does not mutate the input array', () => {
    const input = [...nodes];
    const snapshot = input.map((x) => x.id);
    selectedVideoScenesInFlowOrder(input, new Set(['s1', 's2']));
    expect(input.map((x) => x.id)).toEqual(snapshot);
  });
});

describe('nodeDisplayTitle', () => {
  it('prefers label', () => {
    expect(nodeDisplayTitle(n('x', { label: 'L', displayName: 'D', eventId: '9' }))).toBe('L');
  });
  it('falls back to displayName', () => {
    expect(nodeDisplayTitle(n('x', { displayName: 'D', eventId: '9' }))).toBe('D');
  });
  it('falls back to "Event <eventId>"', () => {
    expect(nodeDisplayTitle(n('x', { eventId: '42' }))).toBe('Event 42');
  });
  it('falls back to "Event <node id>" when there is no eventId', () => {
    expect(nodeDisplayTitle(n('node-7'))).toBe('Event node-7');
  });
});

describe('canSwapOnChain', () => {
  const onchain = (id: string, bid: number) => n(id, { blockchainNodeId: bid });

  it('is false unless exactly two nodes are selected', () => {
    const nodes = [onchain('a', 1), onchain('b', 2), onchain('c', 3)];
    expect(canSwapOnChain(nodes, new Set(['a']))).toBe(false);
    expect(canSwapOnChain(nodes, new Set(['a', 'b', 'c']))).toBe(false);
  });

  it('is false when a selected id is not found in the node list', () => {
    expect(canSwapOnChain([onchain('a', 1)], new Set(['a', 'ghost']))).toBe(false);
  });

  it('is false when either node has no blockchainNodeId (not saved on-chain)', () => {
    const nodes = [onchain('a', 1), n('b')]; // b is a draft
    expect(canSwapOnChain(nodes, new Set(['a', 'b']))).toBe(false);
  });

  it('is false when the two nodes share a blockchainNodeId', () => {
    const nodes = [onchain('a', 5), onchain('b', 5)];
    expect(canSwapOnChain(nodes, new Set(['a', 'b']))).toBe(false);
  });

  it('is true for two distinct on-chain nodes', () => {
    const nodes = [onchain('a', 1), onchain('b', 2)];
    expect(canSwapOnChain(nodes, new Set(['a', 'b']))).toBe(true);
  });

  it('treats blockchainNodeId 0 (genesis) as a real id, not missing', () => {
    const nodes = [onchain('a', 0), onchain('b', 1)];
    expect(canSwapOnChain(nodes, new Set(['a', 'b']))).toBe(true);
  });
});

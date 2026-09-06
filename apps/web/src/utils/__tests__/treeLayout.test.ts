/**
 * Unit tests for treeLayout.ts — the pure Reingold-Tilford-ish layout the
 * universe timeline editor uses to place on/off-chain nodes on the canvas
 * (see universe/$id.tsx's "Convert blockchain data to timeline nodes"
 * effect, which calls calculateTreeLayout + getEventLabel).
 *
 * Framework-free (no React/ReactFlow) — matches the house style in
 * universeGraphPaging.test.ts / normalizeUniverseId.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateTreeLayout,
  getEventLabel,
  normalizeNodeId,
  type TreeLayoutConfig,
} from '../treeLayout';

const CFG: TreeLayoutConfig = {
  horizontalSpacing: 400,
  verticalSpacing: 300,
  startX: 100,
  startY: 200,
};

describe('normalizeNodeId', () => {
  it('passes numbers through unchanged', () => {
    expect(normalizeNodeId(0)).toBe(0);
    expect(normalizeNodeId(42)).toBe(42);
    expect(normalizeNodeId(-3)).toBe(-3);
  });

  it('converts bigint to number', () => {
    expect(normalizeNodeId(0n)).toBe(0);
    expect(normalizeNodeId(146n)).toBe(146);
    expect(normalizeNodeId(9007199254740991n)).toBe(9007199254740991);
  });

  it('parses decimal strings', () => {
    expect(normalizeNodeId('0')).toBe(0);
    expect(normalizeNodeId('146')).toBe(146);
  });

  it('parses a draft branch id by taking the leading integer ("4b" -> 4)', () => {
    // Draft branch nodes carry ids like "4b"/"4bb" before they are saved
    // on-chain; parseInt stops at the first non-digit.
    expect(normalizeNodeId('4b')).toBe(4);
    expect(normalizeNodeId('12bb')).toBe(12);
  });

  it('returns NaN for a non-numeric string rather than throwing', () => {
    expect(Number.isNaN(normalizeNodeId(''))).toBe(true);
    expect(Number.isNaN(normalizeNodeId('abc'))).toBe(true);
  });
});

describe('calculateTreeLayout — linear timeline', () => {
  // 1 -> 2 -> 3 -> 4, the common "single canonical timeline" shape (Fogline).
  const ids = [1, 2, 3, 4];
  const prev = [0, 1, 2, 3];

  it('places the root at exactly (startX, startY)', () => {
    const { nodePositions } = calculateTreeLayout(ids, prev, CFG);
    expect(nodePositions.get(1)).toEqual({ x: 100, y: 200 });
  });

  it('advances x by horizontalSpacing per depth level and keeps y flat', () => {
    // Roots are pinned at startX and carry depth 1, so their children land at
    // depth 2 => x = startX + 2 * horizontalSpacing (the depth-1 column is
    // never occupied). Each subsequent link adds one more horizontalSpacing.
    const { nodePositions } = calculateTreeLayout(ids, prev, CFG);
    expect(nodePositions.get(2)).toEqual({ x: 900, y: 200 });
    expect(nodePositions.get(3)).toEqual({ x: 1300, y: 200 });
    expect(nodePositions.get(4)).toEqual({ x: 1700, y: 200 });
  });

  it('reports depth as distance from root (root children = depth 1)', () => {
    const { nodeDepths } = calculateTreeLayout(ids, prev, CFG);
    expect(nodeDepths.get(2)).toBe(2);
    expect(nodeDepths.get(3)).toBe(3);
    expect(nodeDepths.get(4)).toBe(4);
  });

  it('gives every node on a chain a subtree height of 1', () => {
    const { subtreeHeights } = calculateTreeLayout(ids, prev, CFG);
    for (const id of ids) expect(subtreeHeights.get(id)).toBe(1);
  });

  it('treats previousNode "0" (string) the same as 0 (number) for roots', () => {
    const { nodePositions } = calculateTreeLayout([1, 2], ['0', '1'], CFG);
    expect(nodePositions.get(1)).toEqual({ x: 100, y: 200 });
    expect(nodePositions.get(2)).toEqual({ x: 900, y: 200 });
  });

  it('treats an empty-string previousNode as a root', () => {
    const { nodePositions, nodesByParent } = calculateTreeLayout([7], [''], CFG);
    expect(nodePositions.get(7)).toEqual({ x: 100, y: 200 });
    expect(nodesByParent.get(0)).toEqual([7]);
  });

  it('accepts bigint ids and parent pointers', () => {
    const { nodePositions } = calculateTreeLayout([1n, 2n], [0n, 1n], CFG);
    expect(nodePositions.get(1)).toEqual({ x: 100, y: 200 });
    expect(nodePositions.get(2)).toEqual({ x: 900, y: 200 });
  });
});

describe('calculateTreeLayout — branching', () => {
  // 1 -> 2, then 2 branches into 3 (first child) and 4 (branch).
  //            1(root) - 2 - 3
  //                          \ 4
  const ids = [1, 2, 3, 4];
  const prev = [0, 1, 2, 2];

  it('keeps the first child on the parent y (main-timeline continuation)', () => {
    const { nodePositions } = calculateTreeLayout(ids, prev, CFG);
    expect(nodePositions.get(3)!.y).toBe(nodePositions.get(2)!.y);
  });

  it('offsets the second child downward by the first sibling subtree height * verticalSpacing', () => {
    const { nodePositions } = calculateTreeLayout(ids, prev, CFG);
    // node 2 is at depth 2 (x 900); its children 3 & 4 are at depth 3 (x 1300).
    // sibling 3 is a leaf => height 1 => 4 is offset 1 * 300 below parent y.
    expect(nodePositions.get(4)).toEqual({ x: 1300, y: 500 });
  });

  it('puts branch siblings at the same x (same depth)', () => {
    const { nodePositions } = calculateTreeLayout(ids, prev, CFG);
    expect(nodePositions.get(3)!.x).toBe(nodePositions.get(4)!.x);
  });

  it('sizes an internal node subtree as the sum of its children', () => {
    const { subtreeHeights } = calculateTreeLayout(ids, prev, CFG);
    expect(subtreeHeights.get(2)).toBe(2); // children 3 + 4, each leaf(1)
    expect(subtreeHeights.get(1)).toBe(2);
  });

  it('records children under their parent, sorted ascending by numeric id', () => {
    const { nodesByParent } = calculateTreeLayout([1, 2, 5, 3], [0, 1, 2, 2], CFG);
    expect(nodesByParent.get(2)).toEqual([3, 5]);
  });

  it('stacks a third sibling below the accumulated heights of the first two', () => {
    // 2 -> {3, 4, 5}; 3 and 4 are leaves (h=1 each) => 5 sits at baseY + 2*300
    const { nodePositions } = calculateTreeLayout([1, 2, 3, 4, 5], [0, 1, 2, 2, 2], CFG);
    const baseY = nodePositions.get(2)!.y;
    expect(nodePositions.get(5)!.y).toBe(baseY + 600);
  });

  it('accounts for a deep first-sibling subtree when placing the second sibling', () => {
    // 2 -> {3, 6};  3 -> {4, 5}  => subtree(3) height = 2  => 6 at baseY + 2*300
    const { nodePositions, subtreeHeights } = calculateTreeLayout(
      [1, 2, 3, 4, 5, 6],
      [0, 1, 2, 3, 3, 2],
      CFG
    );
    expect(subtreeHeights.get(3)).toBe(2);
    const baseY = nodePositions.get(2)!.y;
    expect(nodePositions.get(6)!.y).toBe(baseY + 600);
  });
});

describe('calculateTreeLayout — edge cases', () => {
  it('returns empty maps for no nodes', () => {
    const r = calculateTreeLayout([], [], CFG);
    expect(r.nodePositions.size).toBe(0);
    expect(r.nodesByParent.size).toBe(0);
    expect(r.nodeDepths.size).toBe(0);
    expect(r.subtreeHeights.size).toBe(0);
  });

  it('overlaps multiple roots at the same coordinates (documented quirk)', () => {
    // Every parentId===0 node is hard-placed at (startX, startY); the editor
    // relies on saved/auto-layout positions to separate real multi-root graphs.
    const { nodePositions } = calculateTreeLayout([10, 20], [0, 0], CFG);
    expect(nodePositions.get(10)).toEqual({ x: 100, y: 200 });
    expect(nodePositions.get(20)).toEqual({ x: 100, y: 200 });
  });

  it('falls back to startY when a child is listed before its parent', () => {
    // positioning iterates in array order and reads nodePositions.get(parent);
    // an out-of-order child can't see its parent's y yet.
    const { nodePositions } = calculateTreeLayout([2, 1], [1, 0], CFG);
    expect(nodePositions.get(2)).toEqual({ x: 500, y: 200 });
  });

  it('is deterministic across repeated calls with the same input', () => {
    const a = calculateTreeLayout([1, 2, 3], [0, 1, 1], CFG);
    const b = calculateTreeLayout([1, 2, 3], [0, 1, 1], CFG);
    expect([...a.nodePositions.entries()]).toEqual([...b.nodePositions.entries()]);
  });

  it('handles a missing previousNodes entry (undefined) as a root', () => {
    const { nodesByParent } = calculateTreeLayout([1, 2], [0], CFG);
    // index 1 has no prev entry -> treated as root
    expect(nodesByParent.get(0)).toEqual([1, 2]);
  });

  it('respects a zero-valued spacing config', () => {
    const { nodePositions } = calculateTreeLayout([1, 2, 3], [0, 1, 2], {
      horizontalSpacing: 0,
      verticalSpacing: 0,
      startX: 0,
      startY: 0,
    });
    expect(nodePositions.get(1)).toEqual({ x: 0, y: 0 });
    expect(nodePositions.get(2)).toEqual({ x: 0, y: 0 });
    expect(nodePositions.get(3)).toEqual({ x: 0, y: 0 });
  });
});

describe('getEventLabel', () => {
  it('labels a root with its numeric id', () => {
    expect(getEventLabel(1, 0, new Map())).toBe('1');
    expect(getEventLabel(146, 0, new Map())).toBe('146');
  });

  it('labels the first child with its own id (main-timeline continuation)', () => {
    const byParent = new Map<number, number[]>([[1, [2, 3]]]);
    expect(getEventLabel(2, 1, byParent)).toBe('2');
  });

  it('labels the second child as "<parent>b" and the third as "<parent>c"', () => {
    const byParent = new Map<number, number[]>([[1, [2, 3, 4]]]);
    expect(getEventLabel(3, 1, byParent)).toBe('1b');
    expect(getEventLabel(4, 1, byParent)).toBe('1c');
  });

  it('uses the parent id (not the child id) as the branch label prefix', () => {
    const byParent = new Map<number, number[]>([[7, [8, 99]]]);
    expect(getEventLabel(99, 7, byParent)).toBe('7b');
  });

  it('treats a child missing from the parent list as index -1 => a "`" prefix char', () => {
    // siblingIndex === -1 is falsy-safe (not 0) so it takes the branch path;
    // String.fromCharCode(97 - 1) === '`'. Documents current behaviour.
    const byParent = new Map<number, number[]>([[1, [2]]]);
    expect(getEventLabel(999, 1, byParent)).toBe('1`');
  });

  it('matches the sibling ordering calculateTreeLayout produces', () => {
    const { nodesByParent } = calculateTreeLayout([1, 2, 4, 3], [0, 1, 1, 1], CFG);
    // sorted siblings => [2,3,4]; 2 is main, 3 -> "1b", 4 -> "1c"
    expect(getEventLabel(2, 1, nodesByParent)).toBe('2');
    expect(getEventLabel(3, 1, nodesByParent)).toBe('1b');
    expect(getEventLabel(4, 1, nodesByParent)).toBe('1c');
  });
});

/**
 * Tests for useNodeArcs — localStorage-backed arc (narrative chapter) CRUD
 * for the universe timeline editor. Previously untested (see
 * universe-editor-test-coverage notes); covered here because corrupted or
 * unexpectedly-shaped localStorage is the same failure class behind the
 * "editor nodes disappear" bugs pinned in editorNodePipeline.test.ts — a
 * hook that throws or wipes state on bad stored JSON degrades the editor the
 * same way.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNodeArcs } from '../useNodeArcs';

const KEY = (universeId: string) => `universe_arcs_${universeId}`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('useNodeArcs — load', () => {
  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    expect(result.current.arcs).toEqual([]);
  });

  it('loads previously persisted arcs for the given universe', () => {
    localStorage.setItem(
      KEY('uni-1'),
      JSON.stringify([{ id: 'arc-1', name: 'Act 1', color: '#fff', nodeIds: ['1', '2'] }])
    );
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    expect(result.current.arcs).toHaveLength(1);
    expect(result.current.arcs[0].name).toBe('Act 1');
  });

  it('falls back to empty (not a crash) on corrupted JSON', () => {
    localStorage.setItem(KEY('uni-1'), '{not valid json');
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    expect(result.current.arcs).toEqual([]);
  });

  it('reloads arcs when the universeId prop changes, scoped per-universe', () => {
    localStorage.setItem(
      KEY('uni-a'),
      JSON.stringify([{ id: 'a1', name: 'A', color: '#fff', nodeIds: [] }])
    );
    localStorage.setItem(
      KEY('uni-b'),
      JSON.stringify([{ id: 'b1', name: 'B', color: '#000', nodeIds: [] }])
    );
    const { result, rerender } = renderHook(({ id }) => useNodeArcs(id), {
      initialProps: { id: 'uni-a' },
    });
    expect(result.current.arcs.map((a) => a.name)).toEqual(['A']);

    rerender({ id: 'uni-b' });
    expect(result.current.arcs.map((a) => a.name)).toEqual(['B']);
  });
});

describe('useNodeArcs — mutation + persistence', () => {
  it('addArc appends a new arc and persists it', () => {
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    act(() => {
      result.current.addArc('Act 1');
    });
    expect(result.current.arcs).toHaveLength(1);
    expect(result.current.arcs[0].name).toBe('Act 1');
    expect(result.current.arcs[0].nodeIds).toEqual([]);

    const stored = JSON.parse(localStorage.getItem(KEY('uni-1'))!);
    expect(stored).toHaveLength(1);
  });

  it('addArc cycles through ARC_COLORS rather than reusing the same color forever', () => {
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    // Each addArc is its own act(), matching real usage: a click handler
    // fires, React re-renders, then the next click sees fresh `arcs` state.
    act(() => {
      result.current.addArc('Act 1');
    });
    act(() => {
      result.current.addArc('Act 2');
    });
    const colors = result.current.arcs.map((a) => a.color);
    expect(result.current.arcs).toHaveLength(2);
    expect(colors[0]).not.toBe(colors[1]);
  });

  it('removeArc drops only the targeted arc', () => {
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    let arc1Id = '';
    act(() => {
      arc1Id = result.current.addArc('Act 1').id;
    });
    act(() => {
      result.current.addArc('Act 2');
    });
    act(() => {
      result.current.removeArc(arc1Id);
    });
    expect(result.current.arcs.map((a) => a.name)).toEqual(['Act 2']);
  });

  it('renameArc updates the name without touching nodeIds', () => {
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    let arcId = '';
    act(() => {
      const arc = result.current.addArc('Act 1');
      arcId = arc.id;
    });
    act(() => {
      result.current.addNodesToArc(arcId, ['1', '2']);
    });
    act(() => {
      result.current.renameArc(arcId, 'Act One (Renamed)');
    });
    expect(result.current.arcs[0].name).toBe('Act One (Renamed)');
    expect(result.current.arcs[0].nodeIds).toEqual(['1', '2']);
  });

  it('addNodesToArc assigns nodes and removes them from any other arc they were in (a node belongs to one arc)', () => {
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    let arcA = '';
    let arcB = '';
    act(() => {
      arcA = result.current.addArc('Arc A').id;
    });
    act(() => {
      arcB = result.current.addArc('Arc B').id;
    });
    act(() => {
      result.current.addNodesToArc(arcA, ['1', '2']);
    });
    act(() => {
      result.current.addNodesToArc(arcB, ['2']);
    });
    const a = result.current.arcs.find((x) => x.id === arcA)!;
    const b = result.current.arcs.find((x) => x.id === arcB)!;
    expect(a.nodeIds).toEqual(['1']);
    expect(b.nodeIds).toEqual(['2']);
  });

  it('addNodesToArc de-duplicates when a node is added to the same arc twice', () => {
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    let arcId = '';
    act(() => {
      arcId = result.current.addArc('Arc A').id;
    });
    act(() => {
      result.current.addNodesToArc(arcId, ['1']);
    });
    act(() => {
      result.current.addNodesToArc(arcId, ['1', '2']);
    });
    expect(result.current.arcs[0].nodeIds.sort()).toEqual(['1', '2']);
  });

  it('removeNodesFromArc drops only the given node ids', () => {
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    let arcId = '';
    act(() => {
      arcId = result.current.addArc('Arc A').id;
    });
    act(() => {
      result.current.addNodesToArc(arcId, ['1', '2', '3']);
    });
    act(() => {
      result.current.removeNodesFromArc(arcId, ['2']);
    });
    expect(result.current.arcs[0].nodeIds).toEqual(['1', '3']);
  });

  it('getArcForNode finds the arc containing a node, or undefined if none', () => {
    const { result } = renderHook(() => useNodeArcs('uni-1'));
    let arcId = '';
    act(() => {
      arcId = result.current.addArc('Arc A').id;
    });
    act(() => {
      result.current.addNodesToArc(arcId, ['1']);
    });
    expect(result.current.getArcForNode('1')?.id).toBe(arcId);
    expect(result.current.getArcForNode('unknown')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  commitHistory,
  redoHistory,
  undoHistory,
  useUndoableState,
  type History,
} from '../useUndoableState';

describe('history reducers', () => {
  const h0: History<number> = { past: [], present: 1, future: [] };

  it('commit pushes the old value and clears redo', () => {
    const h1 = commitHistory(h0, 2);
    expect(h1).toEqual({ past: [1], present: 2, future: [] });
    const undone = undoHistory(h1);
    expect(commitHistory(undone, 3)).toEqual({ past: [1], present: 3, future: [] });
  });

  it('commit of the identical value is a no-op (same object)', () => {
    expect(commitHistory(h0, 1)).toBe(h0);
  });

  it('undo/redo walk the stack and stop at the ends', () => {
    let h = commitHistory(commitHistory(h0, 2), 3);
    h = undoHistory(undoHistory(h));
    expect(h.present).toBe(1);
    expect(undoHistory(h)).toBe(h);
    h = redoHistory(redoHistory(h));
    expect(h.present).toBe(3);
    expect(redoHistory(h)).toBe(h);
  });

  it('caps history length', () => {
    let h = h0;
    for (let i = 2; i < 300; i++) h = commitHistory(h, i);
    expect(h.past.length).toBe(100);
  });
});

describe('useUndoableState', () => {
  it('supports updater functions, undo, redo, and un-recorded reset', () => {
    const { result } = renderHook(() => useUndoableState<number[]>([]));
    act(() => result.current.reset([1]));
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.set((p) => [...p, 2]));
    act(() => result.current.set((p) => [...p, 3]));
    expect(result.current.value).toEqual([1, 2, 3]);

    act(() => result.current.undo());
    expect(result.current.value).toEqual([1, 2]);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.value).toEqual([1, 2, 3]);

    act(() => result.current.reset([9]));
    expect(result.current).toMatchObject({ value: [9], canUndo: false, canRedo: false });
  });
});

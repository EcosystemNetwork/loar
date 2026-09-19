import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Node } from 'reactflow';
import { useUndoRedo } from '../useUndoRedo';

type D = { label: string; onEdit?: () => void };

describe('useUndoRedo — onRestore', () => {
  it('passes JSON-cloned snapshots (functions dropped) through onRestore so callbacks can be re-attached', () => {
    const edit = vi.fn();
    const nodes: Node<D>[] = [
      { id: 'a', position: { x: 0, y: 0 }, data: { label: 'a', onEdit: edit } },
    ];
    const setNodes = vi.fn();
    const onRestore = vi.fn((ns: Node<D>[]) =>
      ns.map((n) => ({ ...n, data: { ...n.data, onEdit: edit } }))
    );
    const { result } = renderHook(() =>
      useUndoRedo<D>(nodes, [], setNodes, vi.fn(), 50, onRestore)
    );

    act(() => result.current.pushUndoState());
    act(() => result.current.handleUndo());

    // The raw snapshot lost the function…
    expect(onRestore.mock.calls[0][0][0].data.onEdit).toBeUndefined();
    // …and what was applied has it back.
    expect(setNodes.mock.calls[0][0][0].data.onEdit).toBe(edit);
  });
});

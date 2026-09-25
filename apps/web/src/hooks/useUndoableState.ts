import { useCallback, useState } from 'react';

const MAX_HISTORY = 100;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function commitHistory<T>(h: History<T>, next: T): History<T> {
  if (Object.is(next, h.present)) return h;
  return { past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future: [] };
}

export function undoHistory<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  };
}

export function redoHistory<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/**
 * `useState` with undo/redo. `set` is a drop-in for a state setter (value or
 * updater) that records a history entry; `reset` replaces the value WITHOUT
 * recording one (hydrating from the server must not be undoable).
 */
export function useUndoableState<T>(initial: T) {
  const [history, setHistory] = useState<History<T>>({ past: [], present: initial, future: [] });

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setHistory((h) =>
      commitHistory(h, typeof next === 'function' ? (next as (p: T) => T)(h.present) : next)
    );
  }, []);
  const reset = useCallback((value: T) => setHistory({ past: [], present: value, future: [] }), []);
  const undo = useCallback(() => setHistory(undoHistory), []);
  const redo = useCallback(() => setHistory(redoHistory), []);

  return {
    value: history.present,
    set,
    reset,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}

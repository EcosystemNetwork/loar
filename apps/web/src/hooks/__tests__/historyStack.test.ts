/**
 * Unit tests for GraphHistory — the pure undo/redo stack behind useUndoRedo
 * (the universe timeline editor's Ctrl+Z / Ctrl+Shift+Z).
 *
 * The subtle bits pinned here: a fresh push wipes the redo stack, the cap
 * evicts the *oldest* checkpoint, and each step pushes the *live* state
 * (passed in by the caller) onto the opposite stack so you can always walk
 * back to where you were.
 */
import { describe, expect, it } from 'vitest';
import { GraphHistory } from '../historyStack';

describe('GraphHistory — empty', () => {
  it('starts with nothing to undo or redo', () => {
    const h = new GraphHistory<string>();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undoDepth).toBe(0);
    expect(h.redoDepth).toBe(0);
  });

  it('undo / redo on an empty history return undefined and are no-ops', () => {
    const h = new GraphHistory<string>();
    expect(h.undo('live')).toBeUndefined();
    expect(h.redo('live')).toBeUndefined();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});

describe('GraphHistory — push', () => {
  it('makes the history undoable', () => {
    const h = new GraphHistory<string>();
    h.push('A');
    expect(h.canUndo).toBe(true);
    expect(h.undoDepth).toBe(1);
  });

  it('clears the redo stack (a new edit branches history)', () => {
    const h = new GraphHistory<string>();
    h.push('A');
    h.undo('B'); // redo now holds 'B'
    expect(h.canRedo).toBe(true);
    h.push('C');
    expect(h.canRedo).toBe(false);
    expect(h.redoDepth).toBe(0);
  });

  it('evicts the oldest checkpoint once maxHistory is exceeded', () => {
    const h = new GraphHistory<string>(3);
    h.push('A');
    h.push('B');
    h.push('C');
    h.push('D'); // 'A' should be gone
    expect(h.undoDepth).toBe(3);
    // walk all the way back: D-era live -> C -> B, then empty ('A' evicted)
    expect(h.undo('live')).toBe('D');
    expect(h.undo('live')).toBe('C');
    expect(h.undo('live')).toBe('B');
    expect(h.undo('live')).toBeUndefined();
  });
});

describe('GraphHistory — undo/redo stepping', () => {
  it('undo returns the last checkpoint and stashes the live state for redo', () => {
    const h = new GraphHistory<string>();
    h.push('checkpoint-1');
    const restored = h.undo('live-state');
    expect(restored).toBe('checkpoint-1');
    expect(h.canRedo).toBe(true);
    expect(h.redoDepth).toBe(1);
    expect(h.canUndo).toBe(false);
  });

  it('redo returns the stashed checkpoint and puts the live state back on undo', () => {
    const h = new GraphHistory<string>();
    h.push('cp1');
    const afterUndo = h.undo('live-A'); // -> 'cp1', redo=['live-A']
    expect(afterUndo).toBe('cp1');
    const afterRedo = h.redo('live-B'); // -> 'live-A', undo=['live-B']
    expect(afterRedo).toBe('live-A');
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('supports a multi-step undo then multi-step redo round trip', () => {
    const h = new GraphHistory<number>();
    h.push(1);
    h.push(2);
    h.push(3);
    // undo three times, feeding the "current" value each time
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.canUndo).toBe(false);
    expect(h.redoDepth).toBe(3);
    // redo three times
    expect(h.redo(1)).toBe(2);
    expect(h.redo(2)).toBe(3);
    expect(h.redo(3)).toBe(4);
    expect(h.canRedo).toBe(false);
    expect(h.undoDepth).toBe(3);
  });

  it('a push after some undos drops the now-orphaned redo branch', () => {
    const h = new GraphHistory<string>();
    h.push('a');
    h.push('b');
    h.undo('c'); // back past 'b'; redo=['c']
    h.push('d'); // new branch
    expect(h.canRedo).toBe(false);
    expect(h.undo('e')).toBe('d');
    expect(h.undo('f')).toBe('a');
  });
});

describe('GraphHistory — clear', () => {
  it('drops both stacks', () => {
    const h = new GraphHistory<string>();
    h.push('a');
    h.undo('b');
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undoDepth).toBe(0);
    expect(h.redoDepth).toBe(0);
  });
});

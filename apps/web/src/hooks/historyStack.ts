/**
 * GraphHistory — the pure undo/redo stack machinery behind useUndoRedo.
 *
 * Deliberately framework-free (no React, no cloning) so the stack semantics
 * — redo cleared on a fresh push, oldest snapshot evicted past the cap,
 * current state pushed onto the opposite stack on undo/redo — can be
 * unit-tested directly. useUndoRedo owns the snapshot() deep-clone and the
 * React state mirrors; it just delegates the bookkeeping here.
 */
export class GraphHistory<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  constructor(private readonly maxHistory = 50) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /**
   * Record a new checkpoint. Clears the redo stack (a new edit branches
   * history) and evicts the oldest checkpoint once the cap is exceeded.
   */
  push(snapshot: T): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * Step back. Returns the checkpoint to restore, or undefined when there is
   * nothing to undo. `current` (the live state) is pushed onto the redo
   * stack so a subsequent redo can return to it.
   */
  undo(current: T): T | undefined {
    if (this.undoStack.length === 0) return undefined;
    const prev = this.undoStack.pop() as T;
    this.redoStack.push(current);
    return prev;
  }

  /** Step forward. Mirror image of undo(): the live state goes back onto undo. */
  redo(current: T): T | undefined {
    if (this.redoStack.length === 0) return undefined;
    const next = this.redoStack.pop() as T;
    this.undoStack.push(current);
    return next;
  }

  /** Drop all history (e.g. on universe switch). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

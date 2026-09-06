import { useCallback, useRef, useState } from 'react';
import type { Node, Edge } from 'reactflow';
import { GraphHistory } from './historyStack';

interface GraphSnapshot<TNodeData> {
  nodes: Node<TNodeData>[];
  edges: Edge[];
}

/**
 * Undo/redo history for a ReactFlow graph, keyed on full node+edge
 * snapshots (deep-cloned via JSON round-trip — fine for plain, serializable
 * node data; anything non-JSON-safe on a node won't survive a restore).
 *
 * `nodes`/`edges` are mirrored into refs on every render (the same
 * latest-value-ref trick the editor already used for `nodesRef`) so
 * `pushUndoState`/`handleUndo`/`handleRedo` stay referentially stable —
 * they don't need to change identity just because the graph changed.
 *
 * `canUndo`/`canRedo` are plain state (not just `stack.length`) because a
 * ref mutation alone doesn't trigger a re-render — callers that need to,
 * say, disable an Undo button when the stack empties must read state, not
 * poke at `undoStack.current.length` directly in render.
 */
export function useUndoRedo<TNodeData = unknown>(
  nodes: Node<TNodeData>[],
  edges: Edge[],
  setNodes: (nodes: Node<TNodeData>[]) => void,
  setEdges: (edges: Edge[]) => void,
  maxHistory = 50
) {
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  // Stack bookkeeping (redo-clear-on-push, cap eviction, push-current-on-step)
  // lives in GraphHistory — pure and unit-tested in historyStack.test.ts.
  const historyRef = useRef<GraphHistory<GraphSnapshot<TNodeData>>>(
    new GraphHistory<GraphSnapshot<TNodeData>>(maxHistory)
  );
  const isUndoRedoAction = useRef(false);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const snapshot = useCallback(
    (): GraphSnapshot<TNodeData> => ({
      nodes: JSON.parse(JSON.stringify(nodesRef.current)),
      edges: JSON.parse(JSON.stringify(edgesRef.current)),
    }),
    []
  );

  const pushUndoState = useCallback(() => {
    historyRef.current.push(snapshot());
    setCanUndo(true);
    setCanRedo(false);
  }, [snapshot]);

  const handleUndo = useCallback(() => {
    const prev = historyRef.current.undo(snapshot());
    if (!prev) return;
    isUndoRedoAction.current = true;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(true);
    requestAnimationFrame(() => {
      isUndoRedoAction.current = false;
    });
  }, [snapshot, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const next = historyRef.current.redo(snapshot());
    if (!next) return;
    isUndoRedoAction.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    setCanRedo(historyRef.current.canRedo);
    setCanUndo(true);
    requestAnimationFrame(() => {
      isUndoRedoAction.current = false;
    });
  }, [snapshot, setNodes, setEdges]);

  return { pushUndoState, handleUndo, handleRedo, canUndo, canRedo, isUndoRedoAction };
}

import { useCallback, useRef, useState } from 'react';
import type { Node, Edge } from 'reactflow';

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

  const undoStack = useRef<GraphSnapshot<TNodeData>[]>([]);
  const redoStack = useRef<GraphSnapshot<TNodeData>[]>([]);
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
    undoStack.current.push(snapshot());
    if (undoStack.current.length > maxHistory) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [snapshot, maxHistory]);

  const handleUndo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    isUndoRedoAction.current = true;
    redoStack.current.push(snapshot());
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
    requestAnimationFrame(() => {
      isUndoRedoAction.current = false;
    });
  }, [snapshot, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    isUndoRedoAction.current = true;
    undoStack.current.push(snapshot());
    setNodes(next.nodes);
    setEdges(next.edges);
    setCanRedo(redoStack.current.length > 0);
    setCanUndo(true);
    requestAnimationFrame(() => {
      isUndoRedoAction.current = false;
    });
  }, [snapshot, setNodes, setEdges]);

  return { pushUndoState, handleUndo, handleRedo, canUndo, canRedo, isUndoRedoAction };
}

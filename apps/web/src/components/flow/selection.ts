/**
 * Pure helpers for turning a multi-selection on the timeline canvas into an
 * ordered clip list / a swap-eligibility check.
 *
 * The universe editor had three near-identical copies of "selected scene
 * nodes that have a video, in canvas reading order" (handlePlaySelected, the
 * selection-player playlist, the audio-toolbar clip list) plus the on-chain
 * swap guard. This is the single source.
 */
import type { Node } from 'reactflow';
import type { TimelineNodeData } from './TimelineNodes';

/** Same y-band tolerance the editor has always used to group nodes into rows. */
export const ROW_BAND_PX = 50;

/**
 * Reading order on the canvas: top-to-bottom in ~50px rows, then
 * left-to-right within a row. Stable comparator (returns 0 for genuine ties).
 */
export function compareByCanvasFlow(a: Pick<Node, 'position'>, b: Pick<Node, 'position'>): number {
  if (Math.abs(a.position.y - b.position.y) > ROW_BAND_PX) return a.position.y - b.position.y;
  return a.position.x - b.position.x;
}

/**
 * Whether a node can take part in a multi-selection / bulk action. Only real
 * scene nodes qualify: the "+" add node isn't a scene, and a still-generating
 * placeholder (`isPending`) has no event behind it — letting it into a bulk
 * delete/duplicate either no-ops or removes an in-flight job's placeholder,
 * and counting it as a scene defeats the "don't delete the last scene" guards.
 */
export function isSelectableScene(n: Pick<Node<TimelineNodeData>, 'data'>): boolean {
  return n.data?.nodeType === 'scene' && !n.data.isPending;
}

/**
 * Mirror a selection set into ReactFlow's native `selected` flags.
 *
 * `useOnSelectionChange` recomputes `selectedNodeIds` from those flags, so any
 * code that edits `selectedNodeIds` directly (outline panel, context menu,
 * duplicate…) must also flip the flags — otherwise the next canvas
 * click/shift-click snaps the selection back to the stale native set.
 * Returns the *same* array when nothing changes so it's a no-op store update.
 */
export function applyNativeSelection<T extends Node>(
  nodes: T[],
  selectedIds: ReadonlySet<string>
): T[] {
  let changed = false;
  const next = nodes.map((n) => {
    const shouldBeSelected = selectedIds.has(n.id);
    if (!!n.selected === shouldBeSelected) return n;
    changed = true;
    return { ...n, selected: shouldBeSelected };
  });
  return changed ? next : nodes;
}

/** A scene node that is selected and actually has a video, in canvas flow order. */
export function selectedVideoScenesInFlowOrder(
  nodes: Node<TimelineNodeData>[],
  selectedNodeIds: ReadonlySet<string>
): Node<TimelineNodeData>[] {
  if (selectedNodeIds.size === 0) return [];
  return nodes
    .filter((n) => selectedNodeIds.has(n.id) && !!n.data?.videoUrl && n.data.nodeType === 'scene')
    .slice()
    .sort(compareByCanvasFlow);
}

/** label → displayName → "Event <id>" — the editor's node title fallback chain. */
export function nodeDisplayTitle(n: Node<TimelineNodeData>): string {
  return n.data.label || n.data.displayName || `Event ${n.data.eventId || n.id}`;
}

/**
 * Whether the current selection is exactly two distinct on-chain nodes — the
 * precondition for an on-chain content swap.
 */
export function canSwapOnChain(
  nodes: Node<TimelineNodeData>[],
  selectedNodeIds: ReadonlySet<string>
): boolean {
  if (selectedNodeIds.size !== 2) return false;
  const [a, b] = [...selectedNodeIds];
  const nodeA = nodes.find((n) => n.id === a);
  const nodeB = nodes.find((n) => n.id === b);
  return (
    !!nodeA &&
    !!nodeB &&
    nodeA.data.blockchainNodeId !== undefined &&
    nodeB.data.blockchainNodeId !== undefined &&
    nodeA.data.blockchainNodeId !== nodeB.data.blockchainNodeId
  );
}

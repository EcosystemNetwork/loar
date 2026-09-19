/**
 * Sanity filter for persisted ReactFlow node positions (graphLayouts docs).
 *
 * Saved positions override the freshly computed layout for every node they
 * cover (see useGraphLayout.applySavedPositions), so one bad doc can make an
 * entire canvas look empty on every load with no error:
 *  - a non-finite / non-numeric coordinate (NaN, null, "12") renders the node
 *    nowhere, or trips ReactFlow's transform math;
 *  - a coordinate so far from the origin that fitView (minZoom 0.1) can't
 *    bring it on screen;
 *  - several nodes saved onto one identical point, which reads as a single
 *    node (or none, when the stack sits off-screen).
 * Anything suspicious is dropped so the computed layout wins instead.
 */

export type SavedPosition = { x: number; y: number };

/** Beyond this, fitView at the editor's minZoom (0.1) can't frame the node. */
export const MAX_SAVED_COORDINATE = 50_000;

const isUsable = (p: unknown): p is SavedPosition => {
  if (!p || typeof p !== 'object') return false;
  const { x, y } = p as Record<string, unknown>;
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= MAX_SAVED_COORDINATE &&
    Math.abs(y) <= MAX_SAVED_COORDINATE
  );
};

export interface SanitizedLayout {
  positions: Record<string, SavedPosition>;
  /** Node ids whose saved position was rejected (for diagnostics). */
  rejected: string[];
  /** True when the whole saved layout was discarded as a collapsed stack. */
  collapsed: boolean;
}

/**
 * @param nodeIds ids of the nodes about to be laid out — the collapse check
 *                only looks at saved positions for nodes that are present.
 */
export function sanitizeSavedPositions(
  saved: Record<string, unknown> | null | undefined,
  nodeIds: readonly string[]
): SanitizedLayout {
  const positions: Record<string, SavedPosition> = {};
  const rejected: string[] = [];
  if (!saved) return { positions, rejected, collapsed: false };

  for (const id of nodeIds) {
    if (!(id in saved)) continue;
    const p = saved[id];
    if (isUsable(p)) positions[id] = p;
    else rejected.push(id);
  }

  // ≥3 covered nodes all pinned to a single point is never a deliberate
  // arrangement (two can legitimately be dragged together; three+ is a stack).
  const covered = Object.values(positions);
  if (covered.length >= 3) {
    const first = covered[0];
    if (covered.every((p) => p.x === first.x && p.y === first.y)) {
      return { positions: {}, rejected: [...rejected, ...Object.keys(positions)], collapsed: true };
    }
  }

  return { positions, rejected, collapsed: false };
}

/**
 * Drag-to-trim maths for the segment timeline's edge handles.
 *
 * Trims are stored in milliseconds relative to the ORIGINAL clip
 * (`startTrim` 0..duration, `endTrim` startTrim..duration), the same units
 * `SegmentPlayer` and `VideoTrimmer` use.
 */

/** No segment may be trimmed shorter than this. */
export const MIN_TRIM_MS = 250;

export interface TrimState {
  startTrimMs: number;
  endTrimMs: number;
}

export interface HandleDrag extends TrimState {
  edge: 'start' | 'end';
  /** Horizontal pointer movement since the drag began, in px (right = positive). */
  dxPx: number;
  /** Rendered width of the block when the drag began, in px. */
  blockWidthPx: number;
  /** Full clip length in ms. */
  durationMs: number;
}

/**
 * The block's width represents its currently-visible span (`end - start`), so
 * one pixel is `(end - start) / width` ms. Dragging the start handle right (or
 * the end handle left) shortens the segment; the other direction restores it,
 * up to the original clip bounds.
 */
export function trimFromHandleDrag(d: HandleDrag): TrimState {
  const { edge, dxPx, blockWidthPx, durationMs } = d;
  // Normalize incoming values into the valid range first.
  const start = clamp(d.startTrimMs, 0, durationMs);
  const end = clamp(d.endTrimMs, start, durationMs);
  if (!(blockWidthPx > 0) || !Number.isFinite(dxPx) || durationMs < MIN_TRIM_MS) {
    return { startTrimMs: start, endTrimMs: end };
  }
  const deltaMs = dxPx * ((end - start) / blockWidthPx);
  if (edge === 'start') {
    return {
      startTrimMs: Math.round(clamp(start + deltaMs, 0, end - MIN_TRIM_MS)),
      endTrimMs: end,
    };
  }
  return {
    startTrimMs: start,
    endTrimMs: Math.round(clamp(end + deltaMs, start + MIN_TRIM_MS, durationMs)),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

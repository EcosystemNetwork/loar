/** Visible-window math for the price chart (zoom / pan over a candle array). Pure. */

export interface ChartWindow {
  /** Inclusive start index into the full candle array. */
  start: number;
  /** Exclusive end index. */
  end: number;
}

/** Never zoom in past this many candles (or fewer if there aren't that many). */
export const MIN_VISIBLE = 10;

const minCount = (total: number) => Math.min(MIN_VISIBLE, total);

/** Clamp any window into [0,total] with at least the minimum candle count. */
export function clampWindow(total: number, w: ChartWindow): ChartWindow {
  if (total <= 0) return { start: 0, end: 0 };
  const count = Math.min(Math.max(w.end - w.start, minCount(total)), total);
  const start = Math.min(Math.max(w.start, 0), total - count);
  return { start, end: start + count };
}

/** `null` = the default "show everything" view. */
export function resolveWindow(total: number, view: ChartWindow | null): ChartWindow {
  return view ? clampWindow(total, view) : { start: 0, end: total };
}

/**
 * Zoom around `anchor` (0..1 across the plot). factor < 1 zooms in, > 1 zooms out.
 * Returns null when the result is the full range (so callers can drop back to default).
 */
export function zoomWindow(
  total: number,
  cur: ChartWindow,
  factor: number,
  anchor = 0.5
): ChartWindow | null {
  const count = cur.end - cur.start;
  const newCount = Math.min(Math.max(Math.round(count * factor), minCount(total)), total);
  const anchorIdx = cur.start + anchor * count;
  const next = clampWindow(total, {
    start: Math.round(anchorIdx - anchor * newCount),
    end: Math.round(anchorIdx - anchor * newCount) + newCount,
  });
  return next.start === 0 && next.end === total ? null : next;
}

/** Shift the window by `delta` candles (positive = towards newer). */
export function panWindow(total: number, cur: ChartWindow, delta: number): ChartWindow {
  return clampWindow(total, { start: cur.start + delta, end: cur.end + delta });
}

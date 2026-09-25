/**
 * NleTimeline — the zoomable, scrubbable clip track.
 *
 * Interactions (all pointer-based, one gesture = one undo step):
 *   • drag the ruler / empty track      → scrub the playhead
 *   • click a clip                      → select it and park the playhead there
 *   • drag a clip's body                → reorder (live preview, drops on release)
 *   • drag a clip's left/right handle   → ripple-trim its in/out point
 *
 * Edits are computed by the pure helpers in `lib/timelineEdit.ts`. While a
 * drag is in flight the result is held in local `draft` state and only handed
 * to `onCommit` on release, so undo history gets one entry per gesture.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Music, Scissors } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  moveClip,
  placeClips,
  reorderTarget,
  snapPoints,
  snapTime,
  totalDuration,
  trimClipEdge,
  type DurationMap,
  type PlacedClip,
} from '@/lib/timelineEdit';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';
import type { EpisodeClip } from './EpisodeClipTimeline';

export const MIN_PX_PER_SEC = 4;
export const MAX_PX_PER_SEC = 400;

const RULER_H = 26;
const TRACK_H = 76;
const SNAP_PX = 8;
const DRAG_THRESHOLD_PX = 4;
/** Empty runway after the last clip so there's room to drop / scrub past it. */
const TAIL_PX = 160;

const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

interface NleTimelineProps {
  clips: EpisodeClip[];
  durations: DurationMap;
  playhead: number;
  pxPerSec: number;
  snapping: boolean;
  /** Keep the playhead scrolled into view (during playback). */
  follow: boolean;
  /** Edits are held back until source durations are known. */
  locked: boolean;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  /** `scrub` = the user is dragging the playhead (parent pauses playback). */
  onPlayhead: (t: number, opts?: { scrub?: boolean }) => void;
  onCommit: (clips: EpisodeClip[]) => void;
  onPxPerSecChange: (pxPerSec: number) => void;
}

type ClipDrag = { kind: 'move' | 'trim'; id: string } | null;

function formatRuler(sec: number, step: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const secs = step < 1 ? s.toFixed(step < 0.25 ? 2 : 1) : String(Math.round(s));
  return m > 0 ? `${m}:${secs.padStart(step < 1 ? 4 : 2, '0')}` : `${secs}s`;
}

export function NleTimeline({
  clips,
  durations,
  playhead,
  pxPerSec,
  snapping,
  follow,
  locked,
  selectedIds,
  onSelectedIdsChange,
  onPlayhead,
  onCommit,
  onPxPerSecChange,
}: NleTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<EpisodeClip[] | null>(null);
  const [drag, setDrag] = useState<ClipDrag>(null);

  const basePlaced = useMemo(() => placeClips(clips, durations), [clips, durations]);
  const placed = useMemo(
    () => (draft ? placeClips(draft, durations) : basePlaced),
    [draft, basePlaced, durations]
  );
  const total = totalDuration(placed);
  const baseTotal = totalDuration(basePlaced);
  const width = Math.round(Math.max(total, baseTotal) * pxPerSec + TAIL_PX);

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = innerRef.current?.getBoundingClientRect();
      return rect ? (clientX - rect.left) / pxPerSec : 0;
    },
    [pxPerSec]
  );

  // ── Zoom around the cursor (ctrl/⌘ + wheel) ────────────────────────────
  const zoomAnchor = useRef<{ time: number; x: number } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const next = Math.min(
        MAX_PX_PER_SEC,
        Math.max(MIN_PX_PER_SEC, pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
      );
      zoomAnchor.current = { time: (el.scrollLeft + x) / pxPerSec, x };
      onPxPerSecChange(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pxPerSec, onPxPerSecChange]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchor.current;
    if (!el || !anchor) return;
    el.scrollLeft = Math.max(0, anchor.time * pxPerSec - anchor.x);
    zoomAnchor.current = null;
  }, [pxPerSec]);

  // ── Follow the playhead during playback ────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!follow || !el) return;
    const x = playhead * pxPerSec;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) {
      el.scrollLeft = Math.max(0, x - 40);
    }
  }, [playhead, pxPerSec, follow]);

  // ── Gesture plumbing ───────────────────────────────────────────────────
  const trackGesture = (
    onMove: (e: PointerEvent) => void,
    onUp: (e: PointerEvent) => void
  ): void => {
    const move = (e: PointerEvent) => onMove(e);
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onUp(e);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const scrubTo = (clientX: number) => {
    let t = Math.min(Math.max(0, timeAt(clientX)), baseTotal);
    if (snapping) t = snapTime(t, snapPoints(basePlaced, 0), SNAP_PX / pxPerSec);
    onPlayhead(t, { scrub: true });
  };

  const onScrubStart = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    scrubTo(e.clientX);
    trackGesture(
      (ev) => scrubTo(ev.clientX),
      () => {}
    );
  };

  const onEmptyTrackDown = (e: React.PointerEvent) => {
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) onSelectedIdsChange(new Set());
    onScrubStart(e);
  };

  const onClipDown = (e: React.PointerEvent, p: PlacedClip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (additive) {
      const next = new Set(selectedIds);
      if (next.has(p.clip.nodeId)) next.delete(p.clip.nodeId);
      else next.add(p.clip.nodeId);
      onSelectedIdsChange(next);
    } else if (!selectedIds.has(p.clip.nodeId) || selectedIds.size > 1) {
      onSelectedIdsChange(new Set([p.clip.nodeId]));
    }
    if (locked) return;

    const downX = e.clientX;
    const grab = timeAt(e.clientX) - p.start;
    let moved = false;
    let latest: EpisodeClip[] | null = null;

    trackGesture(
      (ev) => {
        if (!moved && Math.abs(ev.clientX - downX) < DRAG_THRESHOLD_PX) return;
        moved = true;
        setDrag({ kind: 'move', id: p.clip.nodeId });
        const center = timeAt(ev.clientX) - grab + p.length / 2;
        const next = moveClip(clips, p.index, reorderTarget(basePlaced, p.index, center));
        latest = next === clips ? null : next;
        setDraft(latest);
      },
      (ev) => {
        if (!moved) {
          // A plain click parks the playhead inside the clip (handy before a split).
          const t = Math.min(Math.max(timeAt(ev.clientX), p.start), p.start + p.length);
          onPlayhead(t, { scrub: true });
        } else if (latest) {
          onCommit(latest);
        }
        setDraft(null);
        setDrag(null);
      }
    );
  };

  const onHandleDown = (e: React.PointerEvent, p: PlacedClip, edge: 'start' | 'end') => {
    if (e.button !== 0 || locked) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectedIdsChange(new Set([p.clip.nodeId]));

    const downX = e.clientX;
    // Only the out-edge moves on the timeline while trimming (the in-edge stays
    // anchored and the clip shrinks from its tail), so only it can snap.
    const edgeTime = p.start + p.length;
    const points = snapping && edge === 'end' ? snapPoints(basePlaced, playhead, p.index) : [];
    let latest: EpisodeClip[] | null = null;
    setDrag({ kind: 'trim', id: p.clip.nodeId });

    trackGesture(
      (ev) => {
        let delta = (ev.clientX - downX) / pxPerSec;
        if (points.length)
          delta = snapTime(edgeTime + delta, points, SNAP_PX / pxPerSec) - edgeTime;
        const next = trimClipEdge(clips, durations, p.index, edge, delta);
        latest = next === clips ? null : next;
        setDraft(latest);
      },
      () => {
        if (latest) onCommit(latest);
        setDraft(null);
        setDrag(null);
      }
    );
  };

  // ── Ruler ticks ────────────────────────────────────────────────────────
  const tickStep = TICK_STEPS.find((s) => s * pxPerSec >= 70) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = 0; t * pxPerSec <= width; t += tickStep) ticks.push(Math.round(t * 1000) / 1000);

  return (
    <div
      ref={scrollRef}
      className={cn(
        'relative overflow-x-auto overflow-y-hidden rounded-lg border border-border bg-muted/20',
        locked && 'cursor-progress'
      )}
    >
      <div ref={innerRef} className="relative select-none" style={{ width, minWidth: '100%' }}>
        {/* Ruler */}
        <div
          className="relative cursor-col-resize border-b border-border bg-muted/40"
          style={{ height: RULER_H }}
          onPointerDown={onScrubStart}
        >
          {ticks.map((t) => (
            <div
              key={t}
              className="pointer-events-none absolute top-0 h-full border-l border-border/70"
              style={{ left: t * pxPerSec }}
            >
              <span className="absolute left-1 top-1 text-[10px] tabular-nums text-muted-foreground">
                {formatRuler(t, tickStep)}
              </span>
            </div>
          ))}
        </div>

        {/* Track */}
        <div className="relative" style={{ height: TRACK_H + 12 }} onPointerDown={onEmptyTrackDown}>
          {placed.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              Add clips from your library to start cutting
            </div>
          )}
          {placed.map((p) => {
            const selected = selectedIds.has(p.clip.nodeId);
            const dragging = drag?.id === p.clip.nodeId;
            const w = Math.max(2, p.length * pxPerSec - 2);
            const trimmed = p.clip.trimStart > 0 || p.clip.trimEnd > 0;
            return (
              <div
                key={p.clip.nodeId}
                className={cn(
                  'group absolute top-1.5 overflow-hidden rounded-md border bg-primary/25',
                  selected ? 'border-primary ring-2 ring-primary/60' : 'border-primary/40',
                  dragging && 'z-10 opacity-90 shadow-lg',
                  locked ? 'cursor-progress' : 'cursor-grab active:cursor-grabbing'
                )}
                style={{ left: p.start * pxPerSec, width: w, height: TRACK_H }}
                onPointerDown={(e) => onClipDown(e, p)}
                title={`${p.clip.label || p.clip.nodeId} · ${p.length.toFixed(2)}s`}
              >
                {w > 90 && (
                  <video
                    src={`${resolveIpfsUrlPreferred(p.clip.videoUrl)}#t=${p.srcStart.toFixed(2)}`}
                    preload="metadata"
                    muted
                    tabIndex={-1}
                    className="pointer-events-none absolute inset-y-0 left-0 h-full w-24 object-cover opacity-50"
                  />
                )}
                <div className="pointer-events-none relative flex h-full flex-col justify-between p-1.5 pl-2 pr-3">
                  <span className="truncate text-xs font-medium text-foreground drop-shadow">
                    {p.clip.label || p.clip.nodeId}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] tabular-nums text-foreground/80">
                    {p.length.toFixed(1)}s{trimmed && <Scissors className="h-2.5 w-2.5" />}
                    {p.clip.audioUrl && <Music className="h-2.5 w-2.5" />}
                  </span>
                </div>
                {/* Trim handles */}
                <div
                  className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-foreground/20 hover:bg-primary"
                  onPointerDown={(e) => onHandleDown(e, p, 'start')}
                />
                <div
                  className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-foreground/20 hover:bg-primary"
                  onPointerDown={(e) => onHandleDown(e, p, 'end')}
                />
              </div>
            );
          })}
        </div>

        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 z-20 h-full w-px bg-red-500"
          style={{ left: playhead * pxPerSec }}
        >
          <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5.5px] border-t-[8px] border-x-transparent border-t-red-500" />
        </div>
      </div>
    </div>
  );
}

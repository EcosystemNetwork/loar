/**
 * NleTimeline — the zoomable, scrubbable clip track.
 *
 * Interactions (all pointer-based, one gesture = one undo step):
 *   • drag the ruler / empty track      → scrub the playhead
 *   • click a clip                      → select it and park the playhead there
 *   • drag a clip's body                → reorder (live preview, drops on release)
 *   • drag a clip's left/right handle   → ripple-trim its in/out point
 *   • right-click / long-press a clip   → split, duplicate, move, download, delete
 *   • drop library clips or video files → insert at the drop position
 *   • caption lane                      → drag to retime, edges to resize, double-click to add
 *
 * Every clip is keyboard reachable (Tab, Enter to select, Alt+←/→ to reorder) and
 * gestures use pointer events with `touch-action: none`, so touch works too.
 *
 * Edits are computed by the pure helpers in `lib/timelineEdit.ts`. While a
 * drag is in flight the result is held in local `draft` state and only handed
 * to `onCommit` on release, so undo history gets one entry per gesture.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Film, Music, Scissors, Trash2, Type, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  CLIP_DRAG_MIME,
  insertIndexAtTime,
  normalizeOverlay,
  parseClipDrag,
  type DraggedClip,
  type TextOverlay,
} from '@/lib/episodeCut';
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
import { GUTTER_PX, HeaderShell } from './AudioLanes';

export const MIN_PX_PER_SEC = 4;
export const MAX_PX_PER_SEC = 400;

const RULER_H = 26;
const TRACK_H = 76;
const OVERLAY_LANE_H = 26;
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
  /** Caption lane. */
  overlays?: TextOverlay[];
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  onOverlaysCommit?: (overlays: TextOverlay[]) => void;
  onOverlayAdd?: (at: number) => void;
  /** Library clips dropped at `index` (a slot between clips). */
  onDropClips?: (clips: DraggedClip[], index: number) => void;
  /** Video files dropped at `index`. */
  onDropFiles?: (files: File[], index: number) => void;
  /** Context menu / keyboard actions on a clip; `at` is the timeline time under the cursor. */
  onClipAction?: (action: ClipAction, nodeId: string, at: number) => void;
  /**
   * Extra rows rendered below the caption lane (the audio tracks). They share this
   * timeline's horizontal scroll, zoom and playhead, and use the same header
   * column: time 0 is `GUTTER_PX` from the left of every row.
   */
  lanes?: React.ReactNode;
}

type ClipDrag = { kind: 'move' | 'trim'; id: string } | null;

/** What the clip context menu / keyboard can ask the editor to do. */
export type ClipAction =
  | 'split'
  | 'duplicate'
  | 'delete'
  | 'download'
  | 'trim-in'
  | 'trim-out'
  | 'move-earlier'
  | 'move-later';

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
  overlays = [],
  selectedOverlayId = null,
  onSelectOverlay,
  onOverlaysCommit,
  onOverlayAdd,
  onDropClips,
  onDropFiles,
  onClipAction,
  lanes,
}: NleTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<EpisodeClip[] | null>(null);
  const [drag, setDrag] = useState<ClipDrag>(null);
  const [overlayDraft, setOverlayDraft] = useState<TextOverlay[] | null>(null);
  /** Slot a dragged-in clip or file would land in (null when nothing is over the timeline). */
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  /** Timeline time under the last right-click, for "split here". */
  const menuTime = useRef(0);

  const basePlaced = useMemo(() => placeClips(clips, durations), [clips, durations]);
  const placed = useMemo(
    () => (draft ? placeClips(draft, durations) : basePlaced),
    [draft, basePlaced, durations]
  );
  const total = totalDuration(placed);
  const baseTotal = totalDuration(basePlaced);
  const shownOverlays = overlayDraft ?? overlays;
  const width = Math.round(Math.max(total, baseTotal) * pxPerSec + TAIL_PX);

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = innerRef.current?.getBoundingClientRect();
      return rect ? (clientX - rect.left - GUTTER_PX) / pxPerSec : 0;
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
      zoomAnchor.current = { time: (el.scrollLeft + x - GUTTER_PX) / pxPerSec, x };
      onPxPerSecChange(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pxPerSec, onPxPerSecChange]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchor.current;
    if (!el || !anchor) return;
    el.scrollLeft = Math.max(0, anchor.time * pxPerSec + GUTTER_PX - anchor.x);
    zoomAnchor.current = null;
  }, [pxPerSec]);

  // ── Follow the playhead during playback ────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!follow || !el) return;
    const x = GUTTER_PX + playhead * pxPerSec;
    // The sticky header column covers the left GUTTER_PX of the viewport.
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + GUTTER_PX) {
      el.scrollLeft = Math.max(0, x - GUTTER_PX - 40);
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
    onSelectOverlay?.(null);
    onScrubStart(e);
  };

  const onClipDown = (e: React.PointerEvent, p: PlacedClip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    onSelectOverlay?.(null);
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

  // ── Caption lane gestures ───────────────────────────────────────────────
  const onOverlayDown = (e: React.PointerEvent, o: TextOverlay, mode: 'move' | 'start' | 'end') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectOverlay?.(o.id);
    onSelectedIdsChange(new Set());

    const downX = e.clientX;
    const length = o.end - o.start;
    const limit = Math.max(baseTotal, o.end);
    const others = snapPoints(basePlaced, playhead);
    let latest: TextOverlay[] | null = null;

    trackGesture(
      (ev) => {
        const delta = (ev.clientX - downX) / pxPerSec;
        const at = (t: number) => (snapping ? snapTime(t, others, SNAP_PX / pxPerSec) : t);
        let next: TextOverlay;
        if (mode === 'move') {
          const start = Math.min(Math.max(0, at(o.start + delta)), Math.max(0, limit - length));
          next = { ...o, start, end: start + length };
        } else if (mode === 'start') {
          next = { ...o, start: Math.min(Math.max(0, at(o.start + delta)), o.end - 0.5) };
        } else {
          next = { ...o, end: Math.min(Math.max(at(o.end + delta), o.start + 0.5), limit) };
        }
        next = normalizeOverlay(next);
        latest = overlays.map((x) => (x.id === o.id ? next : x));
        setOverlayDraft(latest);
      },
      () => {
        const changed =
          latest &&
          latest.some((x, i) => x.start !== overlays[i]?.start || x.end !== overlays[i]?.end);
        if (changed && latest) onOverlaysCommit?.(latest);
        setOverlayDraft(null);
      }
    );
  };

  // ── Drop targets: library clips and video files ─────────────────────────
  const acceptsDrop = (e: React.DragEvent) =>
    !!(onDropClips || onDropFiles) &&
    (e.dataTransfer.types.includes(CLIP_DRAG_MIME) || e.dataTransfer.types.includes('Files'));

  const onDragOver = (e: React.DragEvent) => {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropIndex(insertIndexAtTime(basePlaced, timeAt(e.clientX)));
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null);
  };

  const onDrop = (e: React.DragEvent) => {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    const index = insertIndexAtTime(basePlaced, timeAt(e.clientX));
    setDropIndex(null);
    const dragged = parseClipDrag(e.dataTransfer.getData(CLIP_DRAG_MIME));
    if (dragged.length) {
      onDropClips?.(dragged, index);
      return;
    }
    const videos = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('video/'));
    if (videos.length) onDropFiles?.(videos, index);
  };

  const dropX = (() => {
    if (dropIndex === null) return null;
    const at = basePlaced[dropIndex];
    return at ? at.start : baseTotal;
  })();

  const onClipKeyDown = (e: React.KeyboardEvent, p: PlacedClip) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = new Set(selectedIds);
      if (next.has(p.clip.nodeId)) next.delete(p.clip.nodeId);
      else next.add(p.clip.nodeId);
      onSelectedIdsChange(next);
      onSelectOverlay?.(null);
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      onClipAction?.(e.key === 'ArrowLeft' ? 'move-earlier' : 'move-later', p.clip.nodeId, p.start);
    }
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
        locked && 'cursor-progress',
        dropIndex !== null && 'ring-2 ring-primary/60'
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        ref={innerRef}
        className="relative select-none"
        style={{ width: GUTTER_PX + width, minWidth: '100%' }}
      >
        {/* Ruler */}
        <div className="flex">
          <HeaderShell height={RULER_H} className="border-border bg-muted/60">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Timeline
            </span>
          </HeaderShell>
          <div
            className="relative flex-1 cursor-col-resize border-b border-border bg-muted/40"
            style={{ height: RULER_H, touchAction: 'none' }}
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
        </div>

        {/* Track */}
        <div className="flex">
          <HeaderShell height={TRACK_H + 12}>
            <div className="flex items-center gap-1">
              <Film className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="text-xs font-medium">Video</span>
            </div>
          </HeaderShell>
          <div
            className="relative flex-1"
            style={{ height: TRACK_H + 12 }}
            role="list"
            aria-label="Episode clips"
            onPointerDown={onEmptyTrackDown}
          >
            {placed.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
                Add clips from your library to start cutting — or drag them (or a video file) here
              </div>
            )}
            {placed.map((p) => {
              const selected = selectedIds.has(p.clip.nodeId);
              const dragging = drag?.id === p.clip.nodeId;
              const w = Math.max(2, p.length * pxPerSec - 2);
              const trimmed = p.clip.trimStart > 0 || p.clip.trimEnd > 0;
              const label = p.clip.label || p.clip.nodeId;
              const hasVolume = p.clip.volume !== undefined && p.clip.volume !== 1;
              const fadeInPx = Math.min((p.clip.fadeIn ?? 0) * pxPerSec, w / 2);
              const fadeOutPx = Math.min((p.clip.fadeOut ?? 0) * pxPerSec, w / 2);
              const act = (action: ClipAction) => () =>
                onClipAction?.(action, p.clip.nodeId, menuTime.current);
              return (
                <ContextMenu key={p.clip.nodeId}>
                  <ContextMenuTrigger asChild>
                    <div
                      role="listitem"
                      tabIndex={0}
                      aria-label={`${label}, ${p.length.toFixed(1)} seconds, clip ${p.index + 1} of ${placed.length}${selected ? ', selected' : ''}. Enter to select, Alt plus arrow keys to move.`}
                      aria-selected={selected}
                      className={cn(
                        'group absolute top-1.5 overflow-hidden rounded-md border bg-primary/25 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected ? 'border-primary ring-2 ring-primary/60' : 'border-primary/40',
                        dragging && 'z-10 opacity-90 shadow-lg',
                        locked ? 'cursor-progress' : 'cursor-grab active:cursor-grabbing'
                      )}
                      style={{
                        left: p.start * pxPerSec,
                        width: w,
                        height: TRACK_H,
                        touchAction: 'none',
                      }}
                      onPointerDown={(e) => onClipDown(e, p)}
                      onContextMenu={(e) => {
                        menuTime.current = Math.min(
                          Math.max(timeAt(e.clientX), p.start),
                          p.start + p.length
                        );
                        if (!selectedIds.has(p.clip.nodeId)) {
                          onSelectedIdsChange(new Set([p.clip.nodeId]));
                        }
                      }}
                      onKeyDown={(e) => onClipKeyDown(e, p)}
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
                      {fadeInPx > 1 && (
                        <div
                          className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/70 to-transparent"
                          style={{ width: fadeInPx }}
                        />
                      )}
                      {fadeOutPx > 1 && (
                        <div
                          className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/70 to-transparent"
                          style={{ width: fadeOutPx }}
                        />
                      )}
                      <div className="pointer-events-none relative flex h-full flex-col justify-between p-1.5 pl-2 pr-3">
                        <span className="truncate text-xs font-medium text-foreground drop-shadow">
                          {label}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] tabular-nums text-foreground/80">
                          {p.length.toFixed(1)}s{trimmed && <Scissors className="h-2.5 w-2.5" />}
                          {p.clip.audioUrl && <Music className="h-2.5 w-2.5" />}
                          {hasVolume && <Volume2 className="h-2.5 w-2.5" />}
                        </span>
                      </div>
                      {/* Trim handles — wider on touch screens */}
                      <div
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-foreground/20 hover:bg-primary [@media(pointer:coarse)]:w-4"
                        style={{ touchAction: 'none' }}
                        onPointerDown={(e) => onHandleDown(e, p, 'start')}
                      />
                      <div
                        aria-hidden
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-foreground/20 hover:bg-primary [@media(pointer:coarse)]:w-4"
                        style={{ touchAction: 'none' }}
                        onPointerDown={(e) => onHandleDown(e, p, 'end')}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={act('split')} disabled={locked}>
                      <Scissors /> Split here <ContextMenuShortcut>S</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={act('trim-in')} disabled={locked}>
                      Trim start to playhead <ContextMenuShortcut>Q</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={act('trim-out')} disabled={locked}>
                      Trim end to playhead <ContextMenuShortcut>W</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={act('duplicate')}>
                      <Copy /> Duplicate <ContextMenuShortcut>⌘D</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={act('move-earlier')} disabled={p.index === 0}>
                      Move earlier <ContextMenuShortcut>Alt ←</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={act('move-later')}
                      disabled={p.index === placed.length - 1}
                    >
                      Move later <ContextMenuShortcut>Alt →</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={act('download')}>
                      <Download /> Download source
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onSelect={act('delete')}>
                      <Trash2 /> Delete <ContextMenuShortcut>Del</ContextMenuShortcut>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
            {dropX !== null && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-primary"
                style={{ left: dropX * pxPerSec - 1 }}
              />
            )}
          </div>
        </div>

        {/* Caption lane */}
        <div className="flex">
          <HeaderShell height={OVERLAY_LANE_H} className="!flex-row items-center gap-1 !py-0">
            <Type className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="text-xs font-medium">Captions</span>
          </HeaderShell>
          <div
            className="relative flex-1 border-t border-border/60 bg-muted/30"
            style={{ height: OVERLAY_LANE_H }}
            aria-label="Captions"
            onDoubleClick={(e) => {
              if (e.target === e.currentTarget) onOverlayAdd?.(Math.max(0, timeAt(e.clientX)));
            }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                onSelectOverlay?.(null);
                onScrubStart(e);
              }
            }}
          >
            {shownOverlays.length === 0 && (
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                Captions — double-click to add one
              </span>
            )}
            {shownOverlays.map((o) => {
              const selected = o.id === selectedOverlayId;
              return (
                <div
                  key={o.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`Caption: ${o.text}`}
                  title={`${o.text} · ${o.start.toFixed(1)}s–${o.end.toFixed(1)}s`}
                  className={cn(
                    'absolute top-0.5 flex cursor-grab items-center overflow-hidden rounded border bg-amber-500/30 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing',
                    selected ? 'border-amber-500 ring-1 ring-amber-500' : 'border-amber-500/50'
                  )}
                  style={{
                    left: o.start * pxPerSec,
                    width: Math.max(6, (o.end - o.start) * pxPerSec),
                    height: OVERLAY_LANE_H - 4,
                    touchAction: 'none',
                  }}
                  onPointerDown={(e) => onOverlayDown(e, o, 'move')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelectOverlay?.(o.id);
                  }}
                >
                  <span className="pointer-events-none truncate px-2 text-[10px] font-medium">
                    {o.text}
                  </span>
                  <div
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-amber-500/60 [@media(pointer:coarse)]:w-3"
                    style={{ touchAction: 'none' }}
                    onPointerDown={(e) => onOverlayDown(e, o, 'start')}
                  />
                  <div
                    aria-hidden
                    className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-amber-500/60 [@media(pointer:coarse)]:w-3"
                    style={{ touchAction: 'none' }}
                    onPointerDown={(e) => onOverlayDown(e, o, 'end')}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {lanes}

        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 z-20 h-full w-px bg-red-500"
          style={{ left: GUTTER_PX + playhead * pxPerSec }}
        >
          <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5.5px] border-t-[8px] border-x-transparent border-t-red-500" />
        </div>
      </div>
    </div>
  );
}

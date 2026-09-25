/**
 * AudioLaneRows — the audio half of the multi-track timeline.
 *
 * Renders a "Video audio" mixer row plus one row per audio track, each made of
 * a sticky header (name, mute, solo, level, add, delete) and a lane of clips
 * with waveforms. It is meant to sit inside the timeline's scrolling area,
 * below the video track, sharing its horizontal zoom and playhead — every row
 * is `[GUTTER header][lane]`, and time 0 is `GUTTER_PX` from the row's left.
 *
 * Interactions (each gesture is one undo step — `onCommit` fires on release):
 *   • drag a clip                → move in time (snaps to edges/playhead), or onto another track
 *   • drag a clip's edge         → trim (the remaining audio doesn't slide)
 *   • drag a clip's top corners  → set fade-in / fade-out
 *   • click a clip               → select it and park the playhead there
 *   • drag empty lane            → scrub
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Music, Plus, Trash2, Video, Volume2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MAX_GAIN,
  MAX_TRACKS,
  PEAKS_PER_SEC,
  TRACK_KIND_LABEL,
  audioSnapPoints,
  clipEnd,
  clipPeakColumns,
  isTrackAudible,
  isVideoAudible,
  moveAudioClip,
  newTrack,
  patchClip,
  patchTrack,
  patchVideoChannel,
  removeTrack,
  trimAudioClipEdge,
  type AudioClip,
  type AudioMix,
  type AudioTrack,
  type TrackKind,
} from '@/lib/audioMix';
import { snapTime } from '@/lib/timelineEdit';
import type { AudioStatus, LoadedAudio } from '@/lib/audioBuffers';

/** Width of the sticky header column; timeline time 0 sits this far from a row's left edge. */
export const GUTTER_PX = 136;
export const LANE_H = 60;
const ADD_ROW_H = 34;
const SNAP_PX = 8;
const DRAG_THRESHOLD_PX = 4;
const FADE_HANDLE = 10;
/** Width of a clip's trim grip; fade handles sit just inside it. */
const EDGE_GRIP = 8;

const KIND_ICON: Record<TrackKind, typeof Music> = {
  music: Music,
  voice: Mic,
  sfx: Zap,
  audio: Volume2,
};

export interface LoadedAudioLookup {
  get: (url: string) => LoadedAudio | undefined;
  status: (url: string) => AudioStatus | undefined;
}

export interface AudioLaneRowsProps {
  mix: AudioMix;
  pxPerSec: number;
  playhead: number;
  snapping: boolean;
  locked: boolean;
  selectedClipIds: Set<string>;
  onSelectedClipIdsChange: (ids: Set<string>) => void;
  onPlayhead: (t: number, opts?: { scrub?: boolean }) => void;
  /** One call per completed gesture / discrete change. */
  onCommit: (mix: AudioMix) => void;
  /** Extra snap targets, e.g. the video clips' edges. */
  extraSnapPoints: number[];
  loaded: LoadedAudioLookup;
  onAddAudio: (trackId: string) => void;
}

// ── Small controls ──────────────────────────────────────────────────────

function ToggleButton({
  label,
  title,
  on,
  tone,
  onClick,
}: {
  label: string;
  title: string;
  on: boolean;
  tone: 'amber' | 'green';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'h-5 w-5 rounded text-[10px] font-bold leading-none transition-colors',
        on
          ? tone === 'amber'
            ? 'bg-amber-500 text-black'
            : 'bg-green-500 text-black'
          : 'bg-foreground/10 text-muted-foreground hover:bg-foreground/20'
      )}
    >
      {label}
    </button>
  );
}

/**
 * A level fader. Dragging updates a local value for instant feedback and
 * commits once on release, so a drag is one undo step.
 */
export function Fader({
  value,
  onCommit,
  label,
  className,
}: {
  value: number;
  onCommit: (v: number) => void;
  label: string;
  className?: string;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const localRef = useRef<number | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = local ?? value;

  const update = (v: number | null) => {
    localRef.current = v;
    setLocal(v);
  };
  const commit = () => {
    if (idle.current) clearTimeout(idle.current);
    const v = localRef.current;
    if (v !== null && v !== value) onCommit(v);
    update(null);
  };
  useEffect(
    () => () => {
      if (idle.current) clearTimeout(idle.current);
    },
    []
  );
  return (
    <input
      type="range"
      min={0}
      max={MAX_GAIN}
      step={0.01}
      value={shown}
      aria-label={label}
      title={`${label}: ${Math.round(shown * 100)}%`}
      className={cn('h-1 min-w-0 flex-1 cursor-pointer accent-primary', className)}
      onChange={(e) => update(Number(e.target.value))}
      onPointerUp={commit}
      // Arrow-key nudging: commit after a pause, so a burst of presses is one undo step.
      onKeyUp={() => {
        if (idle.current) clearTimeout(idle.current);
        idle.current = setTimeout(commit, 500);
      }}
      onBlur={commit}
      // Double-click resets to unity gain, like every DAW.
      onDoubleClick={() => {
        update(null);
        if (value !== 1) onCommit(1);
      }}
    />
  );
}

function HeaderShell({
  height,
  children,
  className,
}: {
  height: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sticky left-0 z-30 flex shrink-0 flex-col justify-center gap-1 border-b border-r border-border bg-card px-2',
        className
      )}
      style={{ width: GUTTER_PX, height }}
    >
      {children}
    </div>
  );
}

function TrackHeader({
  mix,
  track,
  onCommit,
  onAddAudio,
}: {
  mix: AudioMix;
  track: AudioTrack;
  onCommit: (mix: AudioMix) => void;
  onAddAudio: (trackId: string) => void;
}) {
  const Icon = KIND_ICON[track.kind];
  const [renaming, setRenaming] = useState(false);
  const audible = isTrackAudible(mix, track);
  return (
    <HeaderShell height={LANE_H}>
      <div className="flex items-center gap-1">
        <Icon
          className={cn('h-3.5 w-3.5 shrink-0', audible ? 'text-primary' : 'text-muted-foreground')}
        />
        {renaming ? (
          <input
            autoFocus
            defaultValue={track.name}
            maxLength={40}
            className="min-w-0 flex-1 rounded bg-background px-1 text-xs"
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== track.name) onCommit(patchTrack(mix, track.id, { name }));
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <button
            type="button"
            title="Double-click to rename"
            className="min-w-0 flex-1 truncate text-left text-xs font-medium"
            onDoubleClick={() => setRenaming(true)}
          >
            {track.name}
          </button>
        )}
        <ToggleButton
          label="M"
          title={track.muted ? 'Unmute track' : 'Mute track'}
          on={track.muted}
          tone="amber"
          onClick={() => onCommit(patchTrack(mix, track.id, { muted: !track.muted }))}
        />
        <ToggleButton
          label="S"
          title={track.solo ? 'Unsolo track' : 'Solo track'}
          on={track.solo}
          tone="green"
          onClick={() => onCommit(patchTrack(mix, track.id, { solo: !track.solo }))}
        />
      </div>
      <div className="flex items-center gap-1">
        <Fader
          label={`${track.name} level`}
          value={track.volume}
          onCommit={(v) => onCommit(patchTrack(mix, track.id, { volume: v }))}
        />
        <button
          type="button"
          title="Add audio to this track"
          aria-label={`Add audio to ${track.name}`}
          className="rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          onClick={() => onAddAudio(track.id)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Delete track"
          aria-label={`Delete ${track.name}`}
          className="rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
          onClick={() => onCommit(removeTrack(mix, track.id))}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </HeaderShell>
  );
}

// ── Waveform ────────────────────────────────────────────────────────────

function Waveform({
  clip,
  audio,
  widthPx,
  heightPx,
}: {
  clip: AudioClip;
  audio: LoadedAudio | undefined;
  widthPx: number;
  heightPx: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Canvas backing store is capped; CSS stretches it, so very long zoomed clips stay cheap.
  const w = Math.max(1, Math.min(Math.floor(widthPx), 4000));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !audio) return;
    canvas.width = w;
    canvas.height = heightPx;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, heightPx);
    const cols = clipPeakColumns(clip, audio.peaks, audio.duration, w, PEAKS_PER_SEC);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (let x = 0; x < w; x++) {
      const h = Math.max(1, cols[x] * 0.92 * heightPx);
      g.fillRect(x, (heightPx - h) / 2, 1, h);
    }
  }, [audio, clip.trimStart, clip.length, clip.loop, w, heightPx]);

  if (!audio) return null;
  return (
    <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
  );
}

// ── Main ────────────────────────────────────────────────────────────────

export function AudioLaneRows({
  mix,
  pxPerSec,
  playhead,
  snapping,
  locked,
  selectedClipIds,
  onSelectedClipIdsChange,
  onPlayhead,
  onCommit,
  extraSnapPoints,
  loaded,
  onAddAudio,
}: AudioLaneRowsProps) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<AudioMix | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const shown = draft ?? mix;

  // Width the lane needs: the latest clip end (the timeline adds its own tail runway).
  const laneEnd = useMemo(
    () => shown.tracks.reduce((m, t) => t.clips.reduce((n, c) => Math.max(n, clipEnd(c)), m), 0),
    [shown]
  );

  const rect = () => rowsRef.current?.getBoundingClientRect();
  const timeAt = (clientX: number) => {
    const r = rect();
    return r ? (clientX - r.left - GUTTER_PX) / pxPerSec : 0;
  };
  /** Which audio track row the pointer is over (row 0 is the video-audio strip). */
  const trackIndexAt = (clientY: number) => {
    const r = rect();
    if (!r) return 0;
    const i = Math.floor((clientY - r.top - LANE_H) / LANE_H);
    return Math.min(Math.max(i, 0), Math.max(0, mix.tracks.length - 1));
  };

  const gesture = (onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) => {
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onUp(e);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const snapPointsFor = (excludeId?: string) =>
    snapping ? [...audioSnapPoints(mix, playhead, excludeId), ...extraSnapPoints] : [];

  const select = (e: React.PointerEvent, id: string) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const next = new Set(selectedClipIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectedClipIdsChange(next);
    } else if (!selectedClipIds.has(id) || selectedClipIds.size > 1) {
      onSelectedClipIdsChange(new Set([id]));
    }
  };

  const onLaneDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) onSelectedClipIdsChange(new Set());
    const scrub = (x: number) => onPlayhead(Math.max(0, timeAt(x)), { scrub: true });
    scrub(e.clientX);
    gesture(
      (ev) => scrub(ev.clientX),
      () => {}
    );
  };

  const onClipDown = (e: React.PointerEvent, clip: AudioClip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    select(e, clip.id);
    if (locked) return;

    const downX = e.clientX;
    const downY = e.clientY;
    const grab = timeAt(e.clientX) - clip.start;
    const points = snapPointsFor(clip.id);
    const threshold = SNAP_PX / pxPerSec;
    let moved = false;
    let latest: AudioMix | null = null;

    gesture(
      (ev) => {
        // Distance in both axes: a straight-down drag onto another track must start too.
        if (!moved && Math.hypot(ev.clientX - downX, ev.clientY - downY) < DRAG_THRESHOLD_PX) {
          return;
        }
        moved = true;
        setDragId(clip.id);
        let start = timeAt(ev.clientX) - grab;
        if (points.length) {
          // Snap whichever edge is closer to a target: the clip's head or its tail.
          const head = snapTime(start, points, threshold);
          const tail = snapTime(start + clip.length, points, threshold) - clip.length;
          start = Math.abs(head - start) <= Math.abs(tail - start) ? head : tail;
        }
        const dest = mix.tracks[trackIndexAt(ev.clientY)];
        const next = moveAudioClip(mix, clip.id, Math.max(0, start), dest?.id);
        latest = next === mix ? null : next;
        setDraft(latest);
      },
      (ev) => {
        if (!moved) {
          onPlayhead(Math.min(Math.max(timeAt(ev.clientX), clip.start), clipEnd(clip)), {
            scrub: true,
          });
        } else if (latest) {
          onCommit(latest);
        }
        setDraft(null);
        setDragId(null);
      }
    );
  };

  const onEdgeDown = (e: React.PointerEvent, clip: AudioClip, edge: 'start' | 'end') => {
    if (e.button !== 0 || locked) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectedClipIdsChange(new Set([clip.id]));

    const downX = e.clientX;
    const edgeTime = edge === 'start' ? clip.start : clipEnd(clip);
    const points = snapPointsFor(clip.id);
    const threshold = SNAP_PX / pxPerSec;
    let latest: AudioMix | null = null;
    setDragId(clip.id);

    gesture(
      (ev) => {
        let delta = (ev.clientX - downX) / pxPerSec;
        if (points.length) delta = snapTime(edgeTime + delta, points, threshold) - edgeTime;
        const next = trimAudioClipEdge(mix, clip.id, edge, delta);
        latest = next === mix ? null : next;
        setDraft(latest);
      },
      () => {
        if (latest) onCommit(latest);
        setDraft(null);
        setDragId(null);
      }
    );
  };

  const onFadeDown = (e: React.PointerEvent, clip: AudioClip, which: 'in' | 'out') => {
    if (e.button !== 0 || locked) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectedClipIdsChange(new Set([clip.id]));
    let latest: AudioMix | null = null;
    setDragId(clip.id);

    gesture(
      (ev) => {
        const t = timeAt(ev.clientX);
        const next =
          which === 'in'
            ? patchClip(mix, clip.id, { fadeIn: t - clip.start })
            : patchClip(mix, clip.id, { fadeOut: clipEnd(clip) - t });
        latest = next === mix ? null : next;
        setDraft(latest);
      },
      () => {
        if (latest) onCommit(latest);
        setDraft(null);
        setDragId(null);
      }
    );
  };

  const laneWidth = Math.max(0, Math.round(laneEnd * pxPerSec));

  return (
    <div ref={rowsRef} className="relative">
      {/* Video audio strip */}
      <div className="flex" style={{ height: LANE_H }}>
        <HeaderShell height={LANE_H}>
          <div className="flex items-center gap-1">
            <Video
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                isVideoAudible(shown) ? 'text-primary' : 'text-muted-foreground'
              )}
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium" title="Video audio">
              Video
            </span>
            <ToggleButton
              label="M"
              title={mix.mixer.video.muted ? 'Unmute video audio' : 'Mute video audio'}
              on={mix.mixer.video.muted}
              tone="amber"
              onClick={() => onCommit(patchVideoChannel(mix, { muted: !mix.mixer.video.muted }))}
            />
            <ToggleButton
              label="S"
              title={mix.mixer.video.solo ? 'Unsolo video audio' : 'Solo video audio'}
              on={mix.mixer.video.solo}
              tone="green"
              onClick={() => onCommit(patchVideoChannel(mix, { solo: !mix.mixer.video.solo }))}
            />
          </div>
          <div className="flex items-center gap-1">
            <Fader
              label="Video audio level"
              value={mix.mixer.video.volume}
              onCommit={(v) => onCommit(patchVideoChannel(mix, { volume: v }))}
            />
          </div>
        </HeaderShell>
        <div
          className="relative flex-1 border-b border-border bg-muted/10"
          onPointerDown={onLaneDown}
        >
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            The video clips' own audio (edit levels per clip in the inspector)
          </span>
        </div>
      </div>

      {/* Audio tracks */}
      {shown.tracks.map((track) => (
        <div key={track.id} className="flex" style={{ height: LANE_H }} data-track-id={track.id}>
          <TrackHeader mix={mix} track={track} onCommit={onCommit} onAddAudio={onAddAudio} />
          <div
            className={cn(
              'relative flex-1 border-b border-border',
              isTrackAudible(shown, track) ? 'bg-muted/10' : 'bg-muted/30'
            )}
            style={{ minWidth: laneWidth }}
            onPointerDown={onLaneDown}
          >
            {track.clips.map((clip) => {
              const audio = loaded.get(clip.url);
              const status = loaded.status(clip.url);
              const selected = selectedClipIds.has(clip.id);
              const width = Math.max(2, clip.length * pxPerSec - 1);
              const fadeInPx = Math.min(clip.fadeIn, clip.length / 2) * pxPerSec;
              const fadeOutPx = Math.min(clip.fadeOut, clip.length / 2) * pxPerSec;
              return (
                <div
                  key={clip.id}
                  data-clip-id={clip.id}
                  title={`${clip.label || 'Audio'} · ${clip.length.toFixed(2)}s${clip.loop ? ' · looped' : ''}`}
                  className={cn(
                    'group absolute top-1 overflow-hidden rounded border',
                    selected ? 'border-primary ring-2 ring-primary/60' : 'border-primary/40',
                    isTrackAudible(shown, track) ? 'bg-primary/30' : 'bg-muted/60',
                    dragId === clip.id && 'z-10 opacity-90 shadow-lg',
                    locked ? 'cursor-progress' : 'cursor-grab active:cursor-grabbing'
                  )}
                  style={{
                    left: clip.start * pxPerSec,
                    width,
                    height: LANE_H - 9,
                  }}
                  onPointerDown={(e) => onClipDown(e, clip)}
                >
                  <Waveform clip={clip} audio={audio} widthPx={width} heightPx={LANE_H - 9} />
                  {/* Fade shading */}
                  {fadeInPx > 1 && (
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/55 to-transparent"
                      style={{ width: fadeInPx }}
                    />
                  )}
                  {fadeOutPx > 1 && (
                    <div
                      className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/55 to-transparent"
                      style={{ width: fadeOutPx }}
                    />
                  )}
                  <div className="pointer-events-none relative flex items-center gap-1 px-2 pt-0.5">
                    <span className="truncate text-[10px] font-medium text-foreground drop-shadow">
                      {clip.label || 'Audio'}
                    </span>
                    {status === 'loading' && (
                      <span className="text-[9px] text-foreground/70">loading…</span>
                    )}
                    {(status === 'unavailable' || status === 'too-large') && (
                      <span
                        className="rounded bg-black/50 px-1 text-[9px] text-foreground/80"
                        title={
                          status === 'too-large'
                            ? 'Too large to preview — it will still be included in the export'
                            : 'Could not be loaded for preview — it will still be included in the export'
                        }
                      >
                        no preview
                      </span>
                    )}
                  </div>
                  {/* Fade handles (top corners) */}
                  <div
                    className="absolute top-0 z-20 cursor-ew-resize rounded-br bg-white/70 opacity-0 hover:!opacity-100 group-hover:opacity-70"
                    style={{
                      left: Math.max(fadeInPx, EDGE_GRIP),
                      width: FADE_HANDLE,
                      height: FADE_HANDLE,
                    }}
                    title="Drag to set fade-in"
                    onPointerDown={(e) => onFadeDown(e, clip, 'in')}
                  />
                  <div
                    className="absolute top-0 z-20 cursor-ew-resize rounded-bl bg-white/70 opacity-0 hover:!opacity-100 group-hover:opacity-70"
                    style={{
                      right: Math.max(fadeOutPx, EDGE_GRIP),
                      width: FADE_HANDLE,
                      height: FADE_HANDLE,
                    }}
                    title="Drag to set fade-out"
                    onPointerDown={(e) => onFadeDown(e, clip, 'out')}
                  />
                  {/* Trim handles */}
                  <div
                    className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize bg-foreground/20 hover:bg-primary"
                    onPointerDown={(e) => onEdgeDown(e, clip, 'start')}
                  />
                  <div
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-foreground/20 hover:bg-primary"
                    onPointerDown={(e) => onEdgeDown(e, clip, 'end')}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Add track */}
      <div className="flex" style={{ height: ADD_ROW_H }}>
        <HeaderShell height={ADD_ROW_H} className="flex-row items-center gap-0.5 !px-1.5">
          {mix.tracks.length >= MAX_TRACKS ? (
            <span className="text-[10px] text-muted-foreground">Track limit reached</span>
          ) : (
            (['music', 'voice', 'sfx'] as TrackKind[]).map((kind) => {
              const Icon = KIND_ICON[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  title={`Add a ${TRACK_KIND_LABEL[kind]} track`}
                  aria-label={`Add a ${TRACK_KIND_LABEL[kind]} track`}
                  className="flex items-center gap-0.5 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  onClick={() => onCommit(newTrack(mix, kind))}
                >
                  <Plus className="h-3 w-3" />
                  <Icon className="h-3 w-3" />
                </button>
              );
            })
          )}
        </HeaderShell>
        <div className="flex-1 border-b border-border" onPointerDown={onLaneDown} />
      </div>
    </div>
  );
}

/** Total height the audio rows take — the timeline uses it to size its playhead. */
export function audioRowsHeight(trackCount: number): number {
  return LANE_H * (1 + trackCount) + ADD_ROW_H;
}

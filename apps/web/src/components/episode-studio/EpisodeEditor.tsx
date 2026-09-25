/**
 * EpisodeEditor — the Premiere-style editing surface for Episode Studio.
 *
 * A live program monitor, a transport/tool bar, and a zoomable timeline over
 * the episode's clip list. All state that persists (the clips) stays owned by
 * the Studio page; this component only owns the playhead, zoom and playback.
 *
 * Shortcuts (ignored while typing in a field):
 *   Space play/pause · S split at playhead · Q / W trim in / out to playhead
 *   Delete ripple-delete selection · ←/→ step a frame (Shift = 1s)
 *   Home/End jump to start/end · ⌘/Ctrl+Z undo · ⇧⌘Z / Ctrl+Y redo · + / − zoom
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Magnet,
  Maximize2,
  Pause,
  Play,
  Redo2,
  Scissors,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useClipDurations } from '@/hooks/useClipDurations';
import {
  formatTimecode,
  placeClips,
  removeClips,
  splitClipAt,
  totalDuration,
  trimEdgeToTime,
} from '@/lib/timelineEdit';
import type { EpisodeClip } from './EpisodeClipTimeline';
import { MAX_PX_PER_SEC, MIN_PX_PER_SEC, NleTimeline } from './NleTimeline';
import { SequencePreview } from './SequencePreview';

const FPS = 30;
const FRAME = 1 / FPS;

interface EpisodeEditorProps {
  clips: EpisodeClip[];
  onChange: (clips: EpisodeClip[]) => void;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

function ToolButton({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="icon"
      className="size-8"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function EpisodeEditor({
  clips,
  onChange,
  selectedIds,
  onSelectedIdsChange,
  undo,
  redo,
  canUndo,
  canRedo,
}: EpisodeEditorProps) {
  const { durations, pending } = useClipDurations(clips.map((c) => c.videoUrl));
  const placed = useMemo(() => placeClips(clips, durations), [clips, durations]);
  const total = totalDuration(placed);

  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(30);
  const [snapping, setSnapping] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);

  // Keep the playhead on the timeline when edits shorten it.
  useEffect(() => {
    setPlayhead((p) => Math.min(p, total));
  }, [total]);

  // Any edit (including undo/redo) invalidates the running playback plan.
  useEffect(() => {
    setPlaying(false);
  }, [clips]);

  const setZoom = useCallback(
    (px: number) => setPxPerSec(Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, px))),
    []
  );

  const onPlayhead = useCallback((t: number, opts?: { scrub?: boolean }) => {
    if (opts?.scrub) setPlaying(false);
    setPlayhead(t);
  }, []);

  const fit = useCallback(() => {
    const width = editorRef.current?.clientWidth ?? 0;
    if (total > 0 && width > 0) setZoom((width - 200) / total);
  }, [total, setZoom]);

  // Start zoomed to show the whole episode (once — after that, zoom is the user's).
  const didAutoFit = useRef(false);
  useEffect(() => {
    if (didAutoFit.current || total <= 0) return;
    didAutoFit.current = true;
    fit();
  }, [total, fit]);

  // ── Edit actions ───────────────────────────────────────────────────────
  const canEdit = !pending && clips.length > 0;
  const splitResult = useMemo(
    () => (canEdit ? splitClipAt(clips, durations, playhead) : null),
    [canEdit, clips, durations, playhead]
  );

  const split = () => {
    if (splitResult) onChange(splitResult.clips);
  };
  const deleteSelected = () => {
    if (!selectedIds.size) return;
    onChange(removeClips(clips, selectedIds));
    onSelectedIdsChange(new Set());
  };
  const trimTo = (edge: 'start' | 'end') => {
    if (!canEdit) return;
    const next = trimEdgeToTime(clips, durations, playhead, edge);
    if (next) onChange(next);
  };
  const seekBy = (delta: number) =>
    onPlayhead(Math.min(Math.max(0, playhead + delta), total), { scrub: true });

  // ── Keyboard ───────────────────────────────────────────────────────────
  // The handler reads current values through a ref so the window listener is
  // attached once, not torn down and re-added on every playhead tick.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e) => {
    if (isTypingTarget(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod) {
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      } else if (key === '=' || key === '+') {
        e.preventDefault();
        setZoom(pxPerSec * 1.25);
      } else if (key === '-') {
        e.preventDefault();
        setZoom(pxPerSec / 1.25);
      }
      return;
    }
    if (e.altKey) return;

    switch (key) {
      case ' ':
        e.preventDefault();
        if (clips.length) setPlaying((p) => !p);
        break;
      case 's':
        e.preventDefault();
        split();
        break;
      case 'q':
        e.preventDefault();
        trimTo('start');
        break;
      case 'w':
        e.preventDefault();
        trimTo('end');
        break;
      case 'delete':
      case 'backspace':
        if (selectedIds.size) {
          e.preventDefault();
          deleteSelected();
        }
        break;
      case 'arrowleft':
        e.preventDefault();
        seekBy(e.shiftKey ? -1 : -FRAME);
        break;
      case 'arrowright':
        e.preventDefault();
        seekBy(e.shiftKey ? 1 : FRAME);
        break;
      case 'home':
        e.preventDefault();
        onPlayhead(0, { scrub: true });
        break;
      case 'end':
        e.preventDefault();
        onPlayhead(total, { scrub: true });
        break;
      case '=':
      case '+':
        setZoom(pxPerSec * 1.25);
        break;
      case '-':
        setZoom(pxPerSec / 1.25);
        break;
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div ref={editorRef}>
      <Card className="mb-4 gap-3 p-3">
        {/* Program monitor */}
        <div className="mx-auto w-full max-w-2xl">
          <div className="relative">
            <SequencePreview
              placed={placed}
              playhead={playhead}
              playing={playing}
              onTick={setPlayhead}
              onEnded={() => {
                setPlaying(false);
                setPlayhead(total);
              }}
            />
            {pending && clips.length > 0 && (
              <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded bg-black/70 px-2 py-1 text-[11px] text-white">
                <Loader2 className="h-3 w-3 animate-spin" />
                Reading clip lengths…
              </div>
            )}
          </div>
        </div>

        {/* Transport + tools */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
          <ToolButton title="Undo (⌘Z)" onClick={undo} disabled={!canUndo}>
            <Undo2 />
          </ToolButton>
          <ToolButton title="Redo (⇧⌘Z)" onClick={redo} disabled={!canRedo}>
            <Redo2 />
          </ToolButton>

          <div className="mx-1 h-5 w-px bg-border" />

          <ToolButton
            title="Go to start (Home)"
            onClick={() => onPlayhead(0, { scrub: true })}
            disabled={!clips.length}
          >
            <SkipBack />
          </ToolButton>
          <ToolButton
            title="Back one frame (←)"
            onClick={() => seekBy(-FRAME)}
            disabled={!clips.length}
          >
            <StepBack />
          </ToolButton>
          <ToolButton
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={() => setPlaying((p) => !p)}
            disabled={!clips.length}
          >
            {playing ? <Pause /> : <Play />}
          </ToolButton>
          <ToolButton
            title="Forward one frame (→)"
            onClick={() => seekBy(FRAME)}
            disabled={!clips.length}
          >
            <StepForward />
          </ToolButton>
          <ToolButton
            title="Go to end (End)"
            onClick={() => onPlayhead(total, { scrub: true })}
            disabled={!clips.length}
          >
            <SkipForward />
          </ToolButton>

          <span className="mx-2 font-mono text-sm tabular-nums" aria-label="Playhead timecode">
            {formatTimecode(playhead, FPS)}
            <span className="text-muted-foreground"> / {formatTimecode(total, FPS)}</span>
          </span>

          <div className="mx-1 h-5 w-px bg-border" />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            title="Split the clip at the playhead (S)"
            disabled={!splitResult}
            onClick={split}
          >
            <Scissors className="h-3.5 w-3.5" />
            Split
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            title="Trim the clip's start to the playhead (Q)"
            disabled={!canEdit}
            onClick={() => trimTo('start')}
          >
            Trim in
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            title="Trim the clip's end to the playhead (W)"
            disabled={!canEdit}
            onClick={() => trimTo('end')}
          >
            Trim out
          </Button>
          <ToolButton
            title="Delete selected clips — ripple (Delete)"
            onClick={deleteSelected}
            disabled={!selectedIds.size}
          >
            <Trash2 />
          </ToolButton>

          <div className="flex-1" />

          <ToolButton
            title="Snap to clip edges and the playhead"
            onClick={() => setSnapping((s) => !s)}
            active={snapping}
          >
            <Magnet />
          </ToolButton>
          <ToolButton title="Zoom out (−)" onClick={() => setZoom(pxPerSec / 1.25)}>
            <ZoomOut />
          </ToolButton>
          <ToolButton title="Zoom in (+)" onClick={() => setZoom(pxPerSec * 1.25)}>
            <ZoomIn />
          </ToolButton>
          <ToolButton title="Fit the whole episode" onClick={fit} disabled={!total}>
            <Maximize2 />
          </ToolButton>
        </div>

        <NleTimeline
          clips={clips}
          durations={durations}
          playhead={playhead}
          pxPerSec={pxPerSec}
          snapping={snapping}
          follow={playing}
          locked={pending}
          selectedIds={selectedIds}
          onSelectedIdsChange={onSelectedIdsChange}
          onPlayhead={onPlayhead}
          onCommit={onChange}
          onPxPerSecChange={setZoom}
        />

        <p className={cn('text-[11px] text-muted-foreground')}>
          Click the ruler to scrub · <kbd>S</kbd> split · <kbd>Q</kbd>/<kbd>W</kbd> trim to playhead
          · drag a clip's edge to ripple-trim, its body to reorder · <kbd>⌘</kbd>/<kbd>Ctrl</kbd>
          +scroll to zoom. Preview plays each clip's own audio; a linked audio track is mixed at
          export.
        </p>
      </Card>
    </div>
  );
}

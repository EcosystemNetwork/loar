/**
 * EpisodeEditor — the Premiere-style editing surface for Episode Studio.
 *
 * A live program monitor, a transport/tool bar, and a zoomable timeline over
 * the episode's clip list. All state that persists (the clips) stays owned by
 * the Studio page; this component only owns the playhead, zoom and playback.
 *
 * Shortcuts (ignored while typing in a field) — the full list is in
 * `ShortcutsDialog` (press ?):
 *   Space play/pause · S split at playhead · Q / W trim in / out to playhead
 *   Delete ripple-delete selection · ⌘D duplicate · C add caption
 *   ←/→ step a frame (Shift = 1s) · Home/End jump to start/end
 *   ⌘/Ctrl+Z undo · ⇧⌘Z / Ctrl+Y redo · + / − zoom
 *
 * Owns the playhead, zoom, playback and which caption is selected; the clips,
 * captions and undo history belong to the Studio page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Keyboard,
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
  Type,
  Undo2,
  Volume2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useClipDurations } from '@/hooks/useClipDurations';
import { useAudioBuffers } from '@/hooks/useAudioBuffers';
import { useMixPlayback } from '@/hooks/useMixPlayback';
import {
  EMPTY_MIX,
  MIN_AUDIO_CLIP_SEC,
  addClip,
  clipEnd,
  findClip,
  newTrack,
  patchClip as patchAudioClip,
  previewVideoVolume,
  removeAudioClips,
  setMaster,
  splitAudioClipAt,
  type AudioMix,
} from '@/lib/audioMix';
import {
  duplicateClip,
  newOverlay,
  patchClip,
  patchOverlay,
  type DraggedClip,
  type ExportSettings,
  type TextOverlay,
} from '@/lib/episodeCut';
import {
  formatTimecode,
  moveClip,
  placeClips,
  removeClips,
  splitClipAt,
  totalDuration,
  trimEdgeToTime,
} from '@/lib/timelineEdit';
import type { EpisodeClip } from './EpisodeClipTimeline';
import { AddAudioDialog, type AudioSource } from './AddAudioDialog';
import { AudioClipInspector } from './AudioClipInspector';
import { AudioLaneRows, Fader, GUTTER_PX } from './AudioLanes';
import { CaptionPanel } from './CaptionPanel';
import { ClipInspector } from './ClipInspector';
import { MAX_PX_PER_SEC, MIN_PX_PER_SEC, NleTimeline, type ClipAction } from './NleTimeline';
import { SequencePreview } from './SequencePreview';
import { ShortcutsDialog } from './ShortcutsDialog';

const HINT_KEY = 'loar:episode-studio-hint-dismissed';

function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

const FPS = 30;
const FRAME = 1 / FPS;

interface EpisodeEditorProps {
  clips: EpisodeClip[];
  onChange: (clips: EpisodeClip[]) => void;
  overlays: TextOverlay[];
  onOverlaysChange: (overlays: TextOverlay[]) => void;
  /** Multi-track audio (tracks of timed clips + mixer), mixed down into the final audio track. */
  audioMix?: AudioMix;
  onAudioMixChange?: (mix: AudioMix) => void;
  aspect: ExportSettings['aspect'];
  framing: ExportSettings['framing'];
  /** Library clips dropped on the timeline. */
  onDropClips: (clips: DraggedClip[], index: number) => void;
  /** Video files dropped on the timeline. */
  onDropFiles: (files: File[], index: number) => void;
  onDownloadClip: (clip: EpisodeClip) => void;
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
  overlays,
  onOverlaysChange,
  audioMix = EMPTY_MIX,
  onAudioMixChange = () => {},
  aspect,
  framing,
  onDropClips,
  onDropFiles,
  onDownloadClip,
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

  // Audio tracks: decode every clip's audio once (waveforms + preview), and play the
  // mix in step with the video. The video's own audio is leveled by the mixer too.
  const audioUrls = useMemo(
    () => audioMix.tracks.flatMap((t) => t.clips.map((c) => c.url)),
    [audioMix]
  );
  const buffers = useAudioBuffers(audioUrls);

  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(30);
  const [snapping, setSnapping] = useState(true);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedAudioIds, setSelectedAudioIds] = useState<Set<string>>(new Set());
  /** Track that the "Add audio" dialog will drop into (`''` = pick / create one). */
  const [addAudioFor, setAddAudioFor] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(readHintDismissed);
  /** Spoken by screen readers after each edit (there's no other feedback for them). */
  const [announcement, setAnnouncement] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  const dismissHint = () => {
    setHintDismissed(true);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // storage unavailable — the hint just returns next visit
    }
  };

  // Keep the playhead on the timeline when edits shorten it.
  useEffect(() => {
    setPlayhead((p) => Math.min(p, total));
  }, [total]);

  // Any edit (including undo/redo) invalidates the running playback plan.
  useEffect(() => {
    setPlaying(false);
  }, [clips]);

  // The audio-track mix plays alongside the video, re-scheduled from the playhead if
  // you mute / solo / re-level / edit a track mid-play (unlike clip edits, those
  // don't stop playback — you can mix by ear).
  useMixPlayback({
    mix: audioMix,
    playing,
    playhead,
    getBuffer: buffers.getBuffer,
    buffersVersion: buffers.version,
  });
  const videoVolume = previewVideoVolume(audioMix);

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
    // Room for the header column, the timeline's empty tail runway and the card padding.
    if (total > 0 && width > 0) setZoom((width - GUTTER_PX - 190) / total);
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

  const say = (message: string) => setAnnouncement(message);

  // ── Audio tracks ───────────────────────────────────────────────────────
  // Selection is exclusive across video clips, captions and audio clips so Delete / S
  // always act on the thing you last picked.
  const selectAudio = (ids: Set<string>) => {
    setSelectedAudioIds(ids);
    if (ids.size) {
      onSelectedIdsChange(new Set());
      setSelectedOverlayId(null);
    }
  };
  const selectVideo = (ids: Set<string>) => {
    onSelectedIdsChange(ids);
    if (ids.size) setSelectedAudioIds(new Set());
  };
  const selectOverlay = (id: string | null) => {
    setSelectedOverlayId(id);
    if (id) setSelectedAudioIds(new Set());
  };

  const selectedAudioClips = audioMix.tracks
    .flatMap((t) => t.clips)
    .filter((c) => selectedAudioIds.has(c.id));

  const deleteAudioSelection = () => {
    if (!selectedAudioIds.size) return;
    onAudioMixChange(removeAudioClips(audioMix, selectedAudioIds));
    say(
      selectedAudioIds.size === 1
        ? 'Audio clip deleted'
        : `${selectedAudioIds.size} audio clips deleted`
    );
    setSelectedAudioIds(new Set());
  };

  /** Split every selected audio clip that the playhead is inside. */
  const splitSelectedAudio = () => {
    let next = audioMix;
    const created: string[] = [];
    for (const id of selectedAudioIds) {
      const r = splitAudioClipAt(next, id, playhead);
      if (r) {
        next = r.mix;
        created.push(r.rightId);
      }
    }
    if (next === audioMix) return false;
    onAudioMixChange(next);
    say(
      `Split ${created.length} audio clip${created.length === 1 ? '' : 's'} at ${formatTimecode(playhead, FPS)}`
    );
    return true;
  };
  const canSplitAudio = selectedAudioClips.some(
    (c) => playhead - c.start >= MIN_AUDIO_CLIP_SEC && clipEnd(c) - playhead >= MIN_AUDIO_CLIP_SEC
  );

  const patchSelectedAudio = (patch: Parameters<typeof patchAudioClip>[2]) => {
    let next = audioMix;
    for (const id of selectedAudioIds) next = patchAudioClip(next, id, patch);
    if (next !== audioMix) onAudioMixChange(next);
  };

  /** Drop an audio file on a track at the playhead (creating a track if there is none). */
  const addAudioClip = (source: AudioSource, trackId: string | null) => {
    let mix = audioMix;
    let target = trackId && mix.tracks.some((t) => t.id === trackId) ? trackId : null;
    if (!target) {
      target = mix.tracks[0]?.id ?? null;
    }
    if (!target) {
      mix = newTrack(mix, source.loop ? 'music' : 'audio');
      target = mix.tracks[mix.tracks.length - 1]?.id ?? null;
    }
    if (!target) return;
    // A looped bed fills from the playhead to the end of the picture; otherwise the
    // file's own length (10 s if its metadata couldn't be read).
    const length = source.loop ? Math.max(total - playhead, 1) : (source.duration ?? 10);
    const result = addClip(mix, target, {
      url: source.url,
      label: source.label,
      start: playhead,
      length,
      sourceDuration: source.duration ?? undefined,
      loop: source.loop,
    });
    if (!result.clipId) {
      say('Could not add audio: track or clip limit reached');
      return;
    }
    onAudioMixChange(result.mix);
    selectAudio(new Set([result.clipId]));
    say(`Added audio "${source.label}"`);
  };

  const split = (at = playhead) => {
    // With audio clips selected, S cuts those (like a razor on the selected tracks).
    if (selectedAudioIds.size && at === playhead && splitSelectedAudio()) return;
    if (!canEdit) return;
    const result = splitClipAt(clips, durations, at);
    if (!result) return;
    onChange(result.clips);
    say(`Split clip at ${formatTimecode(at, FPS)}`);
  };
  const deleteIds = (ids: Set<string>) => {
    if (!ids.size) return;
    onChange(removeClips(clips, ids));
    onSelectedIdsChange(new Set());
    say(ids.size === 1 ? 'Clip deleted' : `${ids.size} clips deleted`);
  };
  const deleteSelected = () => deleteIds(selectedIds);
  const duplicateSelected = () => {
    if (!selectedIds.size) return;
    let next = clips;
    for (const c of clips) if (selectedIds.has(c.nodeId)) next = duplicateClip(next, c.nodeId);
    if (next !== clips) {
      onChange(next);
      say(selectedIds.size === 1 ? 'Clip duplicated' : `${selectedIds.size} clips duplicated`);
    }
  };
  const trimTo = (edge: 'start' | 'end') => {
    if (!canEdit) return;
    const next = trimEdgeToTime(clips, durations, playhead, edge);
    if (next) {
      onChange(next);
      say(edge === 'start' ? 'Trimmed clip start' : 'Trimmed clip end');
    }
  };
  const seekBy = (delta: number) =>
    onPlayhead(Math.min(Math.max(0, playhead + delta), total), { scrub: true });

  const addCaption = (at = playhead) => {
    if (total <= 0) return;
    const overlay = newOverlay(at, total);
    onOverlaysChange([...overlays, overlay]);
    setSelectedOverlayId(overlay.id);
    onSelectedIdsChange(new Set());
    say('Caption added');
  };
  const deleteCaption = (id: string) => {
    onOverlaysChange(overlays.filter((o) => o.id !== id));
    setSelectedOverlayId(null);
    say('Caption deleted');
  };

  const onClipAction = (action: ClipAction, nodeId: string, at: number) => {
    const index = clips.findIndex((c) => c.nodeId === nodeId);
    if (index === -1) return;
    switch (action) {
      case 'split':
        split(at);
        break;
      case 'trim-in':
        trimTo('start');
        break;
      case 'trim-out':
        trimTo('end');
        break;
      case 'duplicate':
        onChange(duplicateClip(clips, nodeId));
        say('Clip duplicated');
        break;
      case 'delete':
        deleteIds(new Set(selectedIds.has(nodeId) ? selectedIds : [nodeId]));
        break;
      case 'download':
        onDownloadClip(clips[index]);
        break;
      case 'move-earlier':
      case 'move-later': {
        const to = index + (action === 'move-earlier' ? -1 : 1);
        if (to < 0 || to >= clips.length) break;
        onChange(moveClip(clips, index, to));
        say(`Moved clip to position ${to + 1} of ${clips.length}`);
        break;
      }
    }
  };

  const patchSelected = (patch: Partial<Pick<EpisodeClip, 'volume' | 'fadeIn' | 'fadeOut'>>) => {
    let next = clips;
    for (const id of selectedIds) next = patchClip(next, id, patch);
    if (next !== clips) onChange(next);
  };
  const selectedClips = clips.filter((c) => selectedIds.has(c.nodeId));
  const selectedMinLength = Math.min(
    ...placed.filter((p) => selectedIds.has(p.clip.nodeId)).map((p) => p.length),
    Infinity
  );

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
      } else if (key === 'd') {
        e.preventDefault();
        duplicateSelected();
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
      case 'c':
        e.preventDefault();
        addCaption();
        break;
      case '?':
        e.preventDefault();
        setHelpOpen(true);
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
        if (selectedAudioIds.size) {
          e.preventDefault();
          deleteAudioSelection();
        } else if (selectedIds.size) {
          e.preventDefault();
          deleteSelected();
        } else if (selectedOverlayId) {
          e.preventDefault();
          deleteCaption(selectedOverlayId);
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
        {!hintDismissed && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            <p>
              <strong>New to the editor?</strong> Click the ruler to scrub, press <kbd>S</kbd> to
              split, drag a clip’s edge to trim, right-click a clip for more, and press <kbd>?</kbd>{' '}
              for every shortcut. Your work saves automatically.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={dismissHint}
            >
              Got it
            </Button>
          </div>
        )}

        {/* Program monitor */}
        <div className="mx-auto w-full max-w-2xl">
          <div className="relative">
            <SequencePreview
              placed={placed}
              playhead={playhead}
              playing={playing}
              overlays={overlays}
              aspect={aspect}
              framing={framing}
              videoVolume={videoVolume}
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
            disabled={!splitResult && !canSplitAudio}
            onClick={() => split()}
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
            title="Duplicate selected clips (⌘D)"
            onClick={duplicateSelected}
            disabled={!selectedIds.size}
          >
            <Copy />
          </ToolButton>
          <ToolButton
            title="Add audio at the playhead — music, voice-over, effects"
            onClick={() => setAddAudioFor('')}
          >
            <Volume2 />
          </ToolButton>
          <ToolButton
            title="Add a caption at the playhead (C)"
            onClick={() => addCaption()}
            disabled={total <= 0}
          >
            <Type />
          </ToolButton>
          <ToolButton
            title="Delete selected clips — ripple (Delete)"
            onClick={deleteSelected}
            disabled={!selectedIds.size}
          >
            <Trash2 />
          </ToolButton>

          <div className="flex-1" />

          <div
            className="mr-1 flex w-28 items-center gap-1.5 text-[10px] text-muted-foreground"
            title="Master level — applies to everything mixed into the final audio track"
          >
            <span>Master</span>
            <Fader
              label="Master level"
              value={audioMix.mixer.master}
              onCommit={(v) => onAudioMixChange(setMaster(audioMix, v))}
            />
          </div>
          <ToolButton title="Keyboard shortcuts (?)" onClick={() => setHelpOpen(true)}>
            <Keyboard />
          </ToolButton>
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
          onSelectedIdsChange={selectVideo}
          onPlayhead={onPlayhead}
          onCommit={onChange}
          onPxPerSecChange={setZoom}
          overlays={overlays}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={selectOverlay}
          onOverlaysCommit={onOverlaysChange}
          onOverlayAdd={addCaption}
          onDropClips={onDropClips}
          onDropFiles={onDropFiles}
          onClipAction={onClipAction}
          lanes={
            <AudioLaneRows
              mix={audioMix}
              pxPerSec={pxPerSec}
              playhead={playhead}
              snapping={snapping}
              locked={false}
              selectedClipIds={selectedAudioIds}
              onSelectedClipIdsChange={selectAudio}
              onPlayhead={onPlayhead}
              onCommit={onAudioMixChange}
              extraSnapPoints={placed.flatMap((p) => [p.start, p.start + p.length])}
              loaded={buffers}
              onAddAudio={(trackId) => setAddAudioFor(trackId)}
            />
          }
        />

        {selectedClips.length > 0 && (
          <ClipInspector
            clips={selectedClips}
            minLength={Number.isFinite(selectedMinLength) ? selectedMinLength : 1}
            onPatch={patchSelected}
          />
        )}
        {selectedAudioClips.length > 0 && (
          <AudioClipInspector clips={selectedAudioClips} onPatch={patchSelectedAudio} />
        )}
        <CaptionPanel
          overlays={overlays}
          selectedId={selectedOverlayId}
          total={total}
          onSelect={setSelectedOverlayId}
          onAdd={() => addCaption()}
          onPatch={(id, patch) => onOverlaysChange(patchOverlay(overlays, id, patch))}
          onDelete={deleteCaption}
        />

        <p className="text-[11px] text-muted-foreground md:hidden">
          Tip: tap a clip to select it, then use the toolbar above. Dragging clip edges works by
          touch; a larger screen is easier for detailed cuts.
        </p>
        <p className={cn('hidden text-[11px] text-muted-foreground md:block')}>
          Click the ruler to scrub · <kbd>S</kbd> split · <kbd>Q</kbd>/<kbd>W</kbd> trim to playhead
          · drag a clip's edge to ripple-trim, its body to reorder · <kbd>⌘</kbd>/<kbd>Ctrl</kbd>
          +scroll to zoom · <kbd>?</kbd> all shortcuts. Audio tracks mix down into one final track;
          the preview plays the same mix.
        </p>

        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
        <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
        <AddAudioDialog
          open={addAudioFor !== null}
          onOpenChange={(open) => {
            if (!open) setAddAudioFor(null);
          }}
          trackName={
            addAudioFor ? audioMix.tracks.find((t) => t.id === addAudioFor)?.name : undefined
          }
          onAdd={(source) => addAudioClip(source, addAudioFor || null)}
        />
      </Card>
    </div>
  );
}

/**
 * Episode Studio — the full clip-editing surface for one episode.
 *
 * Lets a universe collaborator trim clips, merge several into one
 * persistent reusable clip (saved to the universe's clip library), pull in
 * outside clips (upload or paste a URL), download any individual clip, and
 * reorder/save/export the episode — all in one dedicated page instead of
 * the quick-create `EpisodeBuilder` modal.
 *
 * Work saves itself: edits autosave after a short pause, a local backup guards
 * against a failed save or crash, and the server keeps restore points (Version
 * history). Exports keep running if you leave the page.
 *
 * Persistence contract is unchanged from `EpisodeBuilder`: `episodes.update`
 * for save, `episodes.export`/`exportStatus` for the final MP4. Merge/trim
 * additionally hit the `clipLibrary` router, which reuses the same ffmpeg
 * pipeline as `episodes.export` (see services/ffmpeg/clip-pipeline.ts on
 * the server) to produce standalone clips.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Combine,
  Download,
  Film,
  History,
  Link2,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { DirectUpload } from '@/components/DirectUpload';
import {
  EpisodeClipTimeline,
  type EpisodeClip,
} from '@/components/episode-studio/EpisodeClipTimeline';
import { EpisodeEditor } from '@/components/episode-studio/EpisodeEditor';
import { ExportPanel } from '@/components/episode-studio/ExportPanel';
import { VersionHistory, type RestoredVersion } from '@/components/episode-studio/VersionHistory';
import { useAutosave } from '@/hooks/useAutosave';
import { useUndoableState } from '@/hooks/useUndoableState';
import type { AudioMix } from '@/lib/audioMix';
import {
  clipFromDragged,
  CLIP_DRAG_MIME,
  cutFromEpisode,
  cutSignature,
  DEFAULT_EXPORT_SETTINGS,
  EMPTY_CUT,
  encodeClipDrag,
  formatSavedAt,
  insertClipsAt,
  type Cut,
  type DraggedClip,
  type ExportSettings,
  type TextOverlay,
} from '@/lib/episodeCut';
import {
  clearDraft,
  draftIsNewer,
  loadDraft,
  saveDraft,
  type EpisodeDraft,
} from '@/lib/episodeDraft';
import { uploadFile, VIDEO_TYPES } from '@/lib/upload-file';
import { trpcClient, SERVER_URL } from '@/utils/trpc';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';

export const Route = createFileRoute('/universe/$id/episode/$episodeId/studio')({
  component: EpisodeStudioPage,
});

interface ClipAsset {
  id: string;
  universeId: string;
  label: string;
  videoUrl: string;
  sourceType: 'merged' | 'trimmed' | 'imported';
  createdAt: string;
}

/** Largest video accepted by drag-and-drop (matches the upload panel). */
const MAX_DROP_MB = 500;

const exportJobKey = (episodeId: string) => `loar:episode-export-job:${episodeId}`;

function readStoredJob(episodeId: string): string | null {
  try {
    return localStorage.getItem(exportJobKey(episodeId));
  } catch {
    return null;
  }
}
function writeStoredJob(episodeId: string, jobId: string | null) {
  try {
    if (jobId) localStorage.setItem(exportJobKey(episodeId), jobId);
    else localStorage.removeItem(exportJobKey(episodeId));
  } catch {
    // storage unavailable — the export still runs, it just won't resume after a reload
  }
}

/** Ask once, at the moment the creator starts an export (a user gesture). */
function requestNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  } catch {
    // unsupported
  }
}
function notifyIfHidden(title: string, body: string) {
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {
    // unsupported
  }
}

function triggerDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadUrlFor(videoUrl: string, filename: string) {
  const params = new URLSearchParams({ url: videoUrl, filename });
  return `${SERVER_URL}/api/clips/download?${params.toString()}`;
}

const safeName = (name: string, fallback: string) =>
  `${(name || fallback).replace(/[^\w-]+/g, '_')}.mp4`;

function isForbidden(err: unknown): boolean {
  return (err as { data?: { code?: string } })?.data?.code === 'FORBIDDEN';
}

/** A draggable tile for the clip library / gallery pickers. */
function ClipTile({
  clip,
  badge,
  onAdd,
  onDownload,
  onDelete,
}: {
  clip: DraggedClip;
  badge: string;
  onAdd: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CLIP_DRAG_MIME, encodeClipDrag([clip]));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className="group relative cursor-grab overflow-hidden rounded-lg border border-border active:cursor-grabbing"
      title={`${clip.label} — drag onto the timeline, or press Add`}
    >
      <video
        src={resolveIpfsUrlPreferred(clip.videoUrl)}
        muted
        preload="metadata"
        draggable={false}
        className="aspect-video w-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/70 px-1.5 py-1">
        <Badge variant="outline" className="border-white/30 text-[9px] text-white">
          {badge}
        </Badge>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <button
            className="flex items-center gap-1 rounded p-1 text-[10px] text-white hover:bg-white/20"
            title="Add to the end of the episode"
            aria-label={`Add ${clip.label} to the episode`}
            onClick={onAdd}
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
          {onDownload && (
            <button
              className="rounded p-1 text-white hover:bg-white/20"
              title="Download"
              aria-label={`Download ${clip.label}`}
              onClick={onDownload}
            >
              <Download className="h-3 w-3" />
            </button>
          )}
          {onDelete && (
            <button
              className="rounded p-1 text-white hover:bg-white/20 hover:text-destructive"
              title="Delete from library"
              aria-label={`Delete ${clip.label} from the library`}
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EpisodeStudioPage() {
  const { id: universeId, episodeId } = useParams({
    from: '/universe/$id/episode/$episodeId/studio',
  });
  const queryClient = useQueryClient();

  const episodeQuery = useQuery({
    queryKey: ['episode', episodeId],
    queryFn: () => trpcClient.episodes.get.query({ episodeId }),
  });

  const libraryQuery = useQuery({
    queryKey: ['clipLibrary', universeId],
    queryFn: () => trpcClient.clipLibrary.list.query({ universeId }) as Promise<ClipAsset[]>,
  });

  // Clips generated in this universe (e.g. from /create) that aren't in the library yet.
  const galleryQuery = useQuery({
    queryKey: ['studioGallery', universeId],
    queryFn: () =>
      trpcClient.gallery.browse.query({
        universeId,
        mediaType: 'video',
        origin: 'all',
        sortBy: 'newest',
        limit: 12,
      }),
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Everything undoable about the cut — clips, captions, soundtrack — shares one
  // history, so ⌘Z always reverts the last thing you did. Server hydration goes
  // through `resetCut` and is deliberately not undoable.
  const {
    value: cut,
    set: setCut,
    reset: resetCut,
    undo: undoCut,
    redo: redoCut,
    canUndo,
    canRedo,
  } = useUndoableState<Cut>(EMPTY_CUT);
  const clips = cut.clips;
  const overlays = cut.overlays;
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);

  const setClips = useCallback(
    (next: EpisodeClip[] | ((prev: EpisodeClip[]) => EpisodeClip[])) =>
      setCut((c) => {
        const clipsNext = typeof next === 'function' ? next(c.clips) : next;
        return clipsNext === c.clips ? c : { ...c, clips: clipsNext };
      }),
    [setCut]
  );
  const setOverlays = useCallback(
    (next: TextOverlay[]) => setCut((c) => (next === c.overlays ? c : { ...c, overlays: next })),
    [setCut]
  );
  const setAudioMix = useCallback(
    (next: AudioMix) => setCut((c) => (next === c.audioMix ? c : { ...c, audioMix: next })),
    [setCut]
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pasteUrl, setPasteUrl] = useState('');
  const [libraryTab, setLibraryTab] = useState<'library' | 'gallery'>('library');
  const [historyOpen, setHistoryOpen] = useState(false);
  // A newer local backup than the server copy (crash / failed save recovery).
  const [recoverable, setRecoverable] = useState<EpisodeDraft | null>(null);
  // Only the episode's creator can save; anyone else gets a read-only notice.
  const [readOnly, setReadOnly] = useState(false);
  // Which episode the local editing state was hydrated from. Keyed by id (not
  // a boolean) so navigating episode → episode in the same mounted component
  // re-hydrates instead of showing — and then saving over the new episode with —
  // the previous one's clips.
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  // Signature of the last saved/loaded editable state, for the dirty check.
  const [savedSnapshot, setSavedSnapshot] = useState('');

  const signature = cutSignature(title, description, cut, exportSettings);
  const hydrated = hydratedFor === episodeId;
  const isDirty = hydrated && signature !== savedSnapshot;

  // Hydrate local editing state once per episode load — mirrors
  // EpisodeBuilder/UniverseProfileEditor: don't clobber in-progress local
  // edits on background refetches.
  useEffect(() => {
    if (!episodeQuery.data || hydratedFor === episodeId) return;
    const data = episodeQuery.data;
    const nextTitle = data.title || '';
    const nextDescription = data.description || '';
    const nextCut = cutFromEpisode({
      clips: data.clips as EpisodeClip[] | undefined,
      overlays: data.overlays as TextOverlay[] | undefined,
      soundtrack: data.soundtrack as Cut['soundtrack'],
      audioMix: data.audioMix,
    });
    const nextSettings = { ...DEFAULT_EXPORT_SETTINGS, ...(data.exportSettings ?? {}) };
    setTitle(nextTitle);
    setDescription(nextDescription);
    resetCut(nextCut);
    setExportSettings(nextSettings);
    setSelectedIds(new Set());
    setMergeJobId(null);
    setReadOnly(false);
    // Pick up an export that was running when the creator last left this page.
    setExportJobId(readStoredJob(episodeId));
    const serverSignature = cutSignature(nextTitle, nextDescription, nextCut, nextSettings);
    setSavedSnapshot(serverSignature);

    const draft = loadDraft(episodeId);
    if (draft) {
      const draftSignature = cutSignature(
        draft.title,
        draft.description,
        draft.cut,
        draft.settings
      );
      if (draftIsNewer(draft, data, draftSignature, serverSignature)) setRecoverable(draft);
      else clearDraft(episodeId);
    } else {
      setRecoverable(null);
    }
    setHydratedFor(episodeId);
  }, [episodeQuery.data, hydratedFor, episodeId]);

  // ── Save ──────────────────────────────────────────────────────────────
  // Everything the save needs is read through this ref at call time, so the
  // autosave timer, ⌘S, export and the unmount flush all write the LATEST state.
  const latest = useRef({ title, description, cut, exportSettings, signature });
  latest.current = { title, description, cut, exportSettings, signature };
  const saveKind = useRef<'manual' | 'auto'>('auto');

  const persist = useCallback(async () => {
    const kind = saveKind.current;
    saveKind.current = 'auto';
    const snap = latest.current;
    if (snap.cut.clips.length === 0) throw new Error('Add at least one clip before saving');
    try {
      await trpcClient.episodes.update.mutate({
        episodeId,
        title: snap.title || 'Untitled Episode',
        description: snap.description,
        clips: snap.cut.clips,
        overlays: snap.cut.overlays,
        soundtrack: snap.cut.soundtrack,
        audioMix: snap.cut.audioMix,
        exportSettings: snap.exportSettings,
        versionKind: kind,
      });
    } catch (err) {
      if (isForbidden(err)) setReadOnly(true);
      throw err;
    }
    setSavedSnapshot(snap.signature);
    // The server now has this exact state — the local backup is redundant.
    if (latest.current.signature === snap.signature) clearDraft(episodeId);
    queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
    queryClient.invalidateQueries({ queryKey: ['episodeVersions', episodeId] });
  }, [episodeId, queryClient]);

  const autosave = useAutosave({
    dirty: isDirty,
    signature,
    enabled: hydrated && !readOnly && clips.length > 0,
    save: persist,
  });

  const saveManually = useCallback(async () => {
    if (readOnly) return;
    if (latest.current.cut.clips.length === 0) {
      toast.error('Add at least one clip before saving');
      return;
    }
    saveKind.current = 'manual';
    const ok = await autosave.saveNow();
    if (ok) toast.success('Episode saved');
    else toast.error('Couldn’t save — your work is backed up on this device. Try again shortly.');
  }, [autosave.saveNow, readOnly]);

  // ⌘S / Ctrl+S saves now instead of opening the browser's "save page" dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveManually();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveManually]);

  // Local backup while there are unsaved edits (see lib/episodeDraft.ts).
  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(
      () =>
        saveDraft(episodeId, {
          title,
          description,
          cut,
          settings: exportSettings,
          savedAt: Date.now(),
        }),
      800
    );
    return () => clearTimeout(timer);
  }, [isDirty, signature, episodeId]);

  // Leaving the page with unsaved edits: flush them (best effort — the request
  // outlives the component). A failed/forbidden state keeps the confirm prompt.
  const flushOnLeave = useRef({ isDirty, readOnly, canSave: false });
  flushOnLeave.current = { isDirty, readOnly, canSave: clips.length > 0 };
  useEffect(
    () => () => {
      const f = flushOnLeave.current;
      if (f.isDirty && !f.readOnly && f.canSave) void persist().catch(() => {});
    },
    [persist]
  );

  // Warn on tab close / reload with unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const restoreDraft = () => {
    if (!recoverable) return;
    setTitle(recoverable.title);
    setDescription(recoverable.description);
    setCut(recoverable.cut);
    setExportSettings(recoverable.settings);
    setRecoverable(null);
    toast.success('Unsaved changes restored');
  };
  const discardDraft = () => {
    clearDraft(episodeId);
    setRecoverable(null);
  };

  const restoreVersion = (v: RestoredVersion) => {
    setTitle(v.title);
    setDescription(v.description);
    setCut(v.cut);
    setSelectedIds(new Set());
  };

  // A ticking clock so "Saved 2 min ago" stays honest.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Export ────────────────────────────────────────────────────────────
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const exportMutation = useMutation({
    mutationFn: async () => {
      requestNotifyPermission();
      // Save first (as a restore point) so the render reads exactly what's on screen.
      saveKind.current = 'manual';
      if (!(await autosave.saveNow()))
        throw new Error('Couldn’t save the episode before exporting');
      const { jobId } = await trpcClient.episodes.export.mutate({ episodeId });
      return jobId;
    },
    onSuccess: (jobId) => {
      writeStoredJob(episodeId, jobId);
      setExportJobId(jobId);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Export failed to start'),
  });

  const { data: exportStatus, isError: exportStatusFailed } = useQuery({
    queryKey: ['episodeExportStatus', exportJobId],
    queryFn: () => trpcClient.episodes.exportStatus.query({ jobId: exportJobId! }),
    enabled: !!exportJobId,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'failed' ? false : 2000;
    },
  });
  const exportState = exportStatus?.status;
  useEffect(() => {
    if (exportState === 'completed') {
      toast.success('Episode exported');
      notifyIfHidden(
        'Your episode is ready',
        'Export finished — come back to watch or download it.'
      );
      writeStoredJob(episodeId, null);
      queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
    }
    if (exportState === 'failed') {
      toast.error(exportStatus?.error || 'Export failed');
      notifyIfHidden('Export failed', exportStatus?.error || 'Open the studio to try again.');
      writeStoredJob(episodeId, null);
    }
  }, [exportState]);
  // A remembered job the server no longer knows about must not spin forever.
  useEffect(() => {
    if (exportStatusFailed) {
      writeStoredJob(episodeId, null);
      setExportJobId(null);
    }
  }, [exportStatusFailed]);

  // ── Import outside clips (upload or paste URL) ─────────────────────────
  const importMutation = useMutation({
    mutationFn: async (vars: { videoUrl: string; label: string }) =>
      trpcClient.clipLibrary.importExternal.mutate({ universeId, ...vars }),
    onSuccess: () => {
      toast.success('Clip added to library');
      setPasteUrl('');
      queryClient.invalidateQueries({ queryKey: ['clipLibrary', universeId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Import failed'),
  });

  // ── Merge selected clips into one persistent library clip ─────────────
  const [mergeJobId, setMergeJobId] = useState<string | null>(null);
  // The clip ids sent to the merge, captured when it starts. The completion
  // handler must use these, not the live selection — the user can change the
  // selection while the render runs, which removed the wrong clips (or none).
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);
  const mergeMutation = useMutation({
    mutationFn: async () => {
      const selected = clips.filter((c) => selectedIds.has(c.nodeId));
      setMergeSourceIds(selected.map((c) => c.nodeId));
      const { jobId } = await trpcClient.clipLibrary.merge.mutate({
        universeId,
        clips: selected.map((c) => ({
          videoUrl: c.videoUrl,
          audioUrl: c.audioUrl,
          trimStart: c.trimStart,
          trimEnd: c.trimEnd,
          volume: c.volume,
          fadeIn: c.fadeIn,
          fadeOut: c.fadeOut,
        })),
        sourceClipIds: selected.map((c) => c.nodeId),
        label: `Merged (${selected.length} clips)`,
      });
      return jobId;
    },
    onSuccess: (jobId) => setMergeJobId(jobId),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Merge failed to start'),
  });

  const { data: mergeStatus } = useQuery({
    queryKey: ['clipRenderStatus', mergeJobId],
    queryFn: () => trpcClient.clipLibrary.renderStatus.query({ jobId: mergeJobId! }),
    enabled: !!mergeJobId,
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.status;
      return status === 'completed' || status === 'failed' ? false : 2000;
    },
  });
  useEffect(() => {
    const status = mergeStatus as any;
    if (!status) return;
    if (status.status === 'completed' && status.outputUrl) {
      // Replace the merged-away clips with one new clip pointing at the
      // library asset, in the position of the first selected clip.
      const sources = new Set(mergeSourceIds);
      setClips((prev) => {
        const firstIndex = prev.findIndex((c) => sources.has(c.nodeId));
        const kept = prev.filter((c) => !sources.has(c.nodeId));
        const mergedClip: EpisodeClip = {
          nodeId: `clip:${status.clipAssetId}`,
          label: `Merged clip`,
          videoUrl: status.outputUrl,
          trimStart: 0,
          trimEnd: 0,
        };
        const insertAt = firstIndex === -1 ? kept.length : Math.min(firstIndex, kept.length);
        return [...kept.slice(0, insertAt), mergedClip, ...kept.slice(insertAt)];
      });
      setSelectedIds((prev) => new Set([...prev].filter((nid) => !sources.has(nid))));
      setMergeJobId(null);
      setMergeSourceIds([]);
      toast.success('Clips merged');
      queryClient.invalidateQueries({ queryKey: ['clipLibrary', universeId] });
    }
    if (status.status === 'failed') {
      toast.error(status.error || 'Merge failed');
      setMergeJobId(null);
    }
  }, [mergeStatus]);

  const deleteLibraryClip = useMutation({
    mutationFn: async (clipAssetId: string) =>
      trpcClient.clipLibrary.delete.mutate({ clipAssetId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clipLibrary', universeId] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Delete failed'),
  });

  // ── Getting clips onto the timeline ───────────────────────────────────
  // insertClipsAt gives every clip a fresh nodeId (the React key + selection /
  // trim / remove handle), so adding the same asset twice is safe.
  const insertClips = useCallback(
    (dragged: DraggedClip[], index: number) => {
      if (!dragged.length) return;
      setClips((prev) => insertClipsAt(prev, dragged.map(clipFromDragged), index));
      toast.success(
        dragged.length === 1
          ? `Added “${dragged[0].label}” to the episode`
          : `Added ${dragged.length} clips to the episode`
      );
    },
    [setClips]
  );
  const appendClip = (clip: DraggedClip) => insertClips([clip], Number.MAX_SAFE_INTEGER);

  /** Video files dropped straight onto the timeline: upload → library → insert. */
  const dropFiles = useCallback(
    async (files: File[], index: number) => {
      let at = index;
      for (const file of files) {
        if (!VIDEO_TYPES.includes(file.type)) {
          toast.error(`“${file.name}” isn’t a supported video (use MP4, WebM, MOV, AVI or MKV)`);
          continue;
        }
        if (file.size > MAX_DROP_MB * 1024 * 1024) {
          toast.error(`“${file.name}” is over ${MAX_DROP_MB}MB`);
          continue;
        }
        const toastId = toast.loading(`Uploading ${file.name}…`);
        try {
          const manifest = await uploadFile(file, (pct) =>
            toast.loading(`Uploading ${file.name}… ${pct}%`, { id: toastId })
          );
          const videoUrl = manifest.uploads[0]?.url;
          if (!videoUrl) throw new Error('The upload returned no URL');
          const label = file.name.replace(/\.[^.]+$/, '') || 'Uploaded clip';
          const { id } = await trpcClient.clipLibrary.importExternal.mutate({
            universeId,
            videoUrl,
            label,
          });
          const position = at;
          setClips((prev) =>
            insertClipsAt(
              prev,
              [clipFromDragged({ id, label, videoUrl })],
              Math.min(position, prev.length)
            )
          );
          at += 1;
          queryClient.invalidateQueries({ queryKey: ['clipLibrary', universeId] });
          toast.success(`Added “${label}” to the episode`, { id: toastId });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Couldn’t upload ${file.name}`, {
            id: toastId,
          });
        }
      }
    },
    [universeId, queryClient, setClips]
  );

  const downloadClip = (clip: EpisodeClip) =>
    triggerDownload(downloadUrlFor(clip.videoUrl, safeName(clip.label, 'clip')));

  const isMerging =
    !!mergeJobId &&
    (mergeStatus as any)?.status !== 'completed' &&
    (mergeStatus as any)?.status !== 'failed';
  const isExporting = !!exportJobId && exportState !== 'completed' && exportState !== 'failed';
  const exportedUrl = episodeQuery.data?.exportUrl || exportStatus?.outputUrl;

  const copyWatchLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/episode/${episodeId}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      toast.error(
        'Couldn’t copy — the link is ' + `${window.location.origin}/episode/${episodeId}`
      );
    }
  };

  const saveStatus = readOnly
    ? { text: 'Read-only — only the creator can save', tone: 'warn' as const }
    : autosave.status === 'saving'
      ? { text: 'Saving…', tone: 'muted' as const }
      : autosave.status === 'error' && isDirty
        ? { text: 'Couldn’t save', tone: 'error' as const }
        : isDirty
          ? { text: 'Unsaved changes', tone: 'muted' as const }
          : autosave.lastSavedAt
            ? { text: `Saved ${formatSavedAt(autosave.lastSavedAt, now)}`, tone: 'ok' as const }
            : { text: 'All changes saved', tone: 'ok' as const };
  // Autosave covers a normal exit; only warn when it can't (failed / read-only).
  const confirmLeave = isDirty && (readOnly || autosave.status === 'error' || clips.length === 0);

  if (episodeQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!episodeQuery.data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Episode not found.</p>
        <Button asChild variant="outline">
          <Link to="/universe/$id" params={{ id: universeId }}>
            Back to universe
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <Link
          to="/universe/$id"
          params={{ id: universeId }}
          onClick={(e) => {
            if (
              confirmLeave &&
              !window.confirm('You have unsaved changes. Leave without saving?')
            ) {
              e.preventDefault();
            }
          }}
          className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to universe
        </Link>

        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Film className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Episode Studio</h1>
          <Badge variant="outline" className="text-[10px]">
            {clips.length} {clips.length === 1 ? 'clip' : 'clips'}
          </Badge>
          <div className="flex-1" />
          <span
            role="status"
            aria-live="polite"
            className={
              'flex items-center gap-1.5 text-xs ' +
              (saveStatus.tone === 'error'
                ? 'text-destructive'
                : saveStatus.tone === 'warn'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground')
            }
          >
            {autosave.status === 'saving' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : saveStatus.tone === 'ok' ? (
              <Check className="h-3 w-3" />
            ) : saveStatus.tone === 'error' || saveStatus.tone === 'warn' ? (
              <AlertTriangle className="h-3 w-3" />
            ) : null}
            {saveStatus.text}
          </span>
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
            <History className="mr-1.5 h-3.5 w-3.5" />
            History
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={readOnly || autosave.status === 'saving'}
            onClick={() => void saveManually()}
            title="Save now (⌘S)"
          >
            {autosave.status === 'saving' ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </div>

        {recoverable && (
          <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm">
              <strong>Unsaved changes found.</strong> This device has a newer copy of this episode
              from {new Date(recoverable.savedAt).toLocaleString()} that never reached the server.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={restoreDraft}>
                Restore them
              </Button>
              <Button size="sm" variant="ghost" onClick={discardDraft}>
                Discard
              </Button>
            </div>
          </Card>
        )}
        {readOnly && (
          <Card className="mb-4 border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            You aren’t this episode’s creator, so your edits can’t be saved. You can still explore
            the editor and preview changes.
          </Card>
        )}

        {/* Title / description */}
        <Card className="mb-4 space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="episode-title">Title</Label>
            <Input
              id="episode-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Episode title"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="episode-description">Description</Label>
            <Textarea
              id="episode-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
            />
          </div>
        </Card>

        {/* Timeline editor — split / ripple-trim / reorder with live preview */}
        <EpisodeEditor
          clips={clips}
          onChange={setClips}
          overlays={overlays}
          onOverlaysChange={setOverlays}
          audioMix={cut.audioMix}
          onAudioMixChange={setAudioMix}
          aspect={exportSettings.aspect}
          framing={exportSettings.framing}
          onDropClips={insertClips}
          onDropFiles={(files, index) => void dropFiles(files, index)}
          onDownloadClip={downloadClip}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          undo={undoCut}
          redo={redoCut}
          canUndo={canUndo}
          canRedo={canRedo}
        />

        {/* Merge toolbar */}
        {selectedIds.size > 0 && (
          <Card className="mb-3 flex items-center justify-between gap-3 border-primary/30 bg-primary/5 p-3">
            <span className="text-sm">
              {selectedIds.size} {selectedIds.size === 1 ? 'clip' : 'clips'} selected
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
              <Button
                size="sm"
                disabled={selectedIds.size < 2 || isMerging}
                onClick={() => mergeMutation.mutate()}
              >
                {isMerging ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Merging {(mergeStatus as any)?.progress ?? 0}%
                  </>
                ) : (
                  <>
                    <Combine className="mr-1.5 h-3.5 w-3.5" />
                    Merge into one clip
                  </>
                )}
              </Button>
            </div>
          </Card>
        )}

        {/* Clip list — the same clips as the timeline, with numeric trim and reorder buttons */}
        <details className="group mb-2 rounded-lg border border-border">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold">
            Clip list &amp; precise trim
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              same clips as the timeline — buttons for reordering, exact trim, download
            </span>
          </summary>
          <div className="p-3 pt-0">
            <EpisodeClipTimeline
              clips={clips}
              selectedIds={selectedIds}
              onReorder={setClips}
              onRemove={(nodeId) => setClips((prev) => prev.filter((c) => c.nodeId !== nodeId))}
              onTrimChange={(nodeId, trimStart, trimEnd) =>
                setClips((prev) =>
                  prev.map((c) => (c.nodeId === nodeId ? { ...c, trimStart, trimEnd } : c))
                )
              }
              onToggleSelect={(nodeId) =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(nodeId)) next.delete(nodeId);
                  else next.add(nodeId);
                  return next;
                })
              }
              onDownload={downloadClip}
            />
          </div>
        </details>

        {/* Add clip */}
        <Card className="mt-4 space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Add clips</h2>
            <Button variant="outline" size="sm" asChild>
              <a
                href={`/create?universe=${encodeURIComponent(universeId)}`}
                target="_blank"
                rel="noopener"
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Generate a new clip
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Drop a video file straight onto the timeline, drag clips up from the library below, or
            use the options here. New generations appear under “From this universe” when you come
            back.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <DirectUpload
                acceptedTypes={VIDEO_TYPES}
                maxSizeMB={MAX_DROP_MB}
                label="Upload a video file"
                onUploadComplete={(manifest) => {
                  const url = manifest.uploads[0]?.url;
                  if (url) importMutation.mutate({ videoUrl: url, label: 'Uploaded clip' });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clip-url">Or paste a video URL</Label>
              <div className="flex gap-2">
                <Input
                  id="clip-url"
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  placeholder="https://…/clip.mp4"
                />
                <Button
                  variant="outline"
                  aria-label="Import this URL"
                  disabled={!pasteUrl.trim() || importMutation.isPending}
                  onClick={() =>
                    importMutation.mutate({ videoUrl: pasteUrl.trim(), label: 'Imported clip' })
                  }
                >
                  <Link2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Clip library + this universe's generations */}
        <Card className="mt-4 space-y-3 p-4">
          <div role="tablist" aria-label="Clip source" className="flex gap-1">
            {(
              [
                [
                  'library',
                  `Clip library${libraryQuery.data?.length ? ` (${libraryQuery.data.length})` : ''}`,
                ],
                ['gallery', 'From this universe'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={libraryTab === id}
                onClick={() => setLibraryTab(id)}
                className={
                  'rounded-md px-3 py-1.5 text-sm ' +
                  (libraryTab === id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                {label}
              </button>
            ))}
          </div>

          {libraryTab === 'library' &&
            (libraryQuery.data?.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {libraryQuery.data.map((asset) => {
                  const clip = { id: asset.id, label: asset.label, videoUrl: asset.videoUrl };
                  return (
                    <ClipTile
                      key={asset.id}
                      clip={clip}
                      badge={asset.sourceType}
                      onAdd={() => appendClip(clip)}
                      onDownload={() =>
                        triggerDownload(
                          downloadUrlFor(asset.videoUrl, safeName(asset.label, 'clip'))
                        )
                      }
                      onDelete={() => deleteLibraryClip.mutate(asset.id)}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your library is empty. Upload or import a clip above, or merge clips on the timeline
                to save one here.
              </p>
            ))}

          {libraryTab === 'gallery' &&
            (galleryQuery.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : galleryQuery.data?.items.some((i) => i.mediaUrl) ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {galleryQuery.data.items
                  .filter((i) => i.mediaUrl)
                  .map((item) => {
                    const clip = {
                      id: `gallery-${item.id}`,
                      label: item.title,
                      videoUrl: item.mediaUrl as string,
                    };
                    return (
                      <ClipTile
                        key={item.id}
                        clip={clip}
                        badge={item.generationModel ? 'generated' : 'gallery'}
                        onAdd={() => appendClip(clip)}
                      />
                    );
                  })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing published to this universe’s gallery yet. Use “Generate a new clip”, then
                come back — it will show up here.
              </p>
            ))}
        </Card>

        <ExportPanel
          settings={exportSettings}
          onSettingsChange={setExportSettings}
          hasClips={clips.length > 0}
          exporting={isExporting || exportMutation.isPending}
          progress={exportStatus?.progress ?? 0}
          stage={exportState}
          warnings={exportStatus?.warnings ?? []}
          exportedUrl={exportedUrl}
          isCanon={!!episodeQuery.data.isCanon}
          universeId={universeId}
          episodeId={episodeId}
          copied={linkCopied}
          onExport={() => exportMutation.mutate()}
          onDownload={() =>
            exportedUrl && triggerDownload(downloadUrlFor(exportedUrl, safeName(title, 'episode')))
          }
          onCopyLink={() => void copyWatchLink()}
        />
      </div>

      <VersionHistory
        episodeId={episodeId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestore={restoreVersion}
      />
    </div>
  );
}

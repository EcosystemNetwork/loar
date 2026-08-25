/**
 * Episode Studio — the full clip-editing surface for one episode.
 *
 * Lets a universe collaborator trim clips, merge several into one
 * persistent reusable clip (saved to the universe's clip library), pull in
 * outside clips (upload or paste a URL), download any individual clip, and
 * reorder/save/export the episode — all in one dedicated page instead of
 * the quick-create `EpisodeBuilder` modal.
 *
 * Persistence contract is unchanged from `EpisodeBuilder`: `episodes.update`
 * for save, `episodes.export`/`exportStatus` for the final MP4. Merge/trim
 * additionally hit the `clipLibrary` router, which reuses the same ffmpeg
 * pipeline as `episodes.export` (see services/ffmpeg/clip-pipeline.ts on
 * the server) to produce standalone clips.
 */
import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Combine,
  Download,
  Film,
  Link2,
  Loader2,
  Save,
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

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clips, setClips] = useState<EpisodeClip[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pasteUrl, setPasteUrl] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate local editing state once per episode load — mirrors
  // EpisodeBuilder/UniverseProfileEditor: don't clobber in-progress local
  // edits on background refetches.
  useEffect(() => {
    if (!episodeQuery.data || hydrated) return;
    setTitle(episodeQuery.data.title || '');
    setDescription(episodeQuery.data.description || '');
    setClips((episodeQuery.data.clips as EpisodeClip[]) || []);
    setHydrated(true);
  }, [episodeQuery.data, hydrated]);

  const toggleSelect = (nodeId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // ── Save ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      await trpcClient.episodes.update.mutate({
        episodeId,
        title: title || 'Untitled Episode',
        description,
        clips,
      });
    },
    onSuccess: () => {
      toast.success('Episode saved');
      queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to save'),
  });

  // ── Export (unchanged contract — episodes.export / exportStatus) ──────
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const exportMutation = useMutation({
    mutationFn: async () => {
      await trpcClient.episodes.update.mutate({
        episodeId,
        title: title || 'Untitled Episode',
        description,
        clips,
      });
      const { jobId } = await trpcClient.episodes.export.mutate({ episodeId });
      return jobId;
    },
    onSuccess: (jobId) => setExportJobId(jobId),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Export failed to start'),
  });

  const { data: exportStatus } = useQuery({
    queryKey: ['episodeExportStatus', exportJobId],
    queryFn: () => trpcClient.episodes.exportStatus.query({ jobId: exportJobId! }),
    enabled: !!exportJobId,
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.status;
      return status === 'completed' || status === 'failed' ? false : 2000;
    },
  });
  useEffect(() => {
    if ((exportStatus as any)?.status === 'completed') {
      toast.success('Episode exported');
      queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
    }
    if ((exportStatus as any)?.status === 'failed') {
      toast.error((exportStatus as any)?.error || 'Export failed');
    }
  }, [(exportStatus as any)?.status]);

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
  const mergeMutation = useMutation({
    mutationFn: async () => {
      const selected = clips.filter((c) => selectedIds.has(c.nodeId));
      const { jobId } = await trpcClient.clipLibrary.merge.mutate({
        universeId,
        clips: selected.map((c) => ({
          videoUrl: c.videoUrl,
          audioUrl: c.audioUrl,
          trimStart: c.trimStart,
          trimEnd: c.trimEnd,
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
      setClips((prev) => {
        const firstIndex = prev.findIndex((c) => selectedIds.has(c.nodeId));
        const kept = prev.filter((c) => !selectedIds.has(c.nodeId));
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
      setSelectedIds(new Set());
      setMergeJobId(null);
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

  const addLibraryClipToEpisode = (asset: ClipAsset) => {
    setClips((prev) => [
      ...prev,
      {
        nodeId: `clip:${asset.id}`,
        label: asset.label,
        videoUrl: asset.videoUrl,
        trimStart: 0,
        trimEnd: 0,
      },
    ]);
    toast.success(`Added "${asset.label}" to the episode`);
  };

  const isMerging =
    !!mergeJobId &&
    (mergeStatus as any)?.status !== 'completed' &&
    (mergeStatus as any)?.status !== 'failed';
  const isExporting =
    !!exportJobId &&
    (exportStatus as any)?.status !== 'completed' &&
    (exportStatus as any)?.status !== 'failed';
  const exportedUrl = episodeQuery.data?.exportUrl || (exportStatus as any)?.outputUrl;

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
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        <Link
          to="/universe/$id"
          params={{ id: universeId }}
          className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to universe
        </Link>

        <div className="mb-6 flex items-center gap-2">
          <Film className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Episode Studio</h1>
          <Badge variant="outline" className="text-[10px]">
            {clips.length} clips
          </Badge>
        </div>

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

        {/* Merge toolbar */}
        {selectedIds.size > 0 && (
          <Card className="mb-3 flex items-center justify-between gap-3 border-primary/30 bg-primary/5 p-3">
            <span className="text-sm">{selectedIds.size} clips selected</span>
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

        {/* Timeline */}
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
          onToggleSelect={toggleSelect}
          onDownload={(clip) =>
            triggerDownload(
              downloadUrlFor(
                clip.videoUrl,
                `${(clip.label || 'clip').replace(/[^\w-]+/g, '_')}.mp4`
              )
            )
          }
        />

        {/* Add clip */}
        <Card className="mt-4 space-y-3 p-4">
          <h2 className="text-sm font-semibold">Add an outside clip</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <DirectUpload
                acceptedTypes={[
                  'video/mp4',
                  'video/webm',
                  'video/quicktime',
                  'video/x-msvideo',
                  'video/x-matroska',
                ]}
                maxSizeMB={500}
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

        {/* Clip library */}
        {!!libraryQuery.data?.length && (
          <Card className="mt-4 space-y-2 p-4">
            <h2 className="text-sm font-semibold">Clip library</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {libraryQuery.data.map((asset) => (
                <div
                  key={asset.id}
                  className="group relative overflow-hidden rounded-lg border border-border"
                >
                  <video
                    src={resolveIpfsUrlPreferred(asset.videoUrl)}
                    muted
                    preload="metadata"
                    className="aspect-video w-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/70 px-1.5 py-1">
                    <Badge variant="outline" className="border-white/30 text-[9px] text-white">
                      {asset.sourceType}
                    </Badge>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        className="rounded p-1 text-white hover:bg-white/20"
                        title="Add to episode"
                        onClick={() => addLibraryClipToEpisode(asset)}
                      >
                        <Film className="h-3 w-3" />
                      </button>
                      <button
                        className="rounded p-1 text-white hover:bg-white/20"
                        title="Download"
                        onClick={() =>
                          triggerDownload(
                            downloadUrlFor(
                              asset.videoUrl,
                              `${asset.label.replace(/[^\w-]+/g, '_')}.mp4`
                            )
                          )
                        }
                      >
                        <Download className="h-3 w-3" />
                      </button>
                      <button
                        className="rounded p-1 text-white hover:bg-white/20 hover:text-destructive"
                        title="Delete from library"
                        onClick={() => deleteLibraryClip.mutate(asset.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Save / Export */}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {exportedUrl && (
            <Button variant="outline" asChild>
              <a
                href={downloadUrlFor(
                  exportedUrl,
                  `${(title || 'episode').replace(/[^\w-]+/g, '_')}.mp4`
                )}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Download episode
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Save
          </Button>
          <Button disabled={!clips.length || isExporting} onClick={() => exportMutation.mutate()}>
            {isExporting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Exporting {(exportStatus as any)?.progress ?? 0}%
              </>
            ) : (
              <>
                <Upload className="mr-1.5 h-4 w-4" />
                Sync &amp; export episode
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * EpisodeList — browse saved episodes for a universe and export them to MP4.
 *
 * Shows all episodes created for the given universeId (from Firestore via
 * trpc.episodes.list). Each row exposes:
 *   - Play: opens a sequential SelectionPlayer over the episode's clips
 *   - Export: kicks off server-side FFmpeg concat → polls status → download link
 */

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Film, Play, Download, Loader2, AlertCircle, Check } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SelectionPlayer } from '@/components/player/SelectionPlayer';

interface EpisodeClip {
  nodeId: string;
  label: string;
  videoUrl: string;
  audioUrl?: string;
}

interface Episode {
  id: string;
  universeId: string;
  title: string;
  description?: string;
  clips: EpisodeClip[];
  clipCount: number;
  creatorId?: string;
  exportUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  isCanon?: boolean;
}

interface EpisodeListProps {
  universeId: string;
  onClose: () => void;
}

export function EpisodeList({ universeId, onClose }: EpisodeListProps) {
  const [playingEpisode, setPlayingEpisode] = useState<Episode | null>(null);
  const [exportJob, setExportJob] = useState<{ episodeId: string; jobId: string } | null>(null);

  const {
    data: episodes,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['universeEpisodes', universeId],
    queryFn: () => trpcClient.episodes.list.query({ universeId, limit: 50 }) as Promise<Episode[]>,
  });

  const exportMutation = useMutation({
    mutationFn: async (episodeId: string) => {
      const { jobId } = await trpcClient.episodes.export.mutate({ episodeId });
      return { episodeId, jobId };
    },
    onSuccess: (job) => setExportJob(job),
  });

  const { data: exportStatus } = useQuery({
    queryKey: ['episodeExportStatus', exportJob?.jobId],
    queryFn: () => trpcClient.episodes.exportStatus.query({ jobId: exportJob!.jobId }),
    enabled: !!exportJob,
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.status;
      if (status === 'completed' || status === 'failed') return false;
      return 2000;
    },
  });

  // Refresh list when export completes so exportUrl updates
  useMemo(() => {
    if ((exportStatus as any)?.status === 'completed') refetch();
  }, [(exportStatus as any)?.status, refetch]);

  const playerVideos = useMemo(() => {
    if (!playingEpisode) return [];
    return playingEpisode.clips.map((c, i) => ({
      nodeId: c.nodeId || `clip-${i}`,
      label: c.label || `Clip ${i + 1}`,
      videoUrl: c.videoUrl,
    }));
  }, [playingEpisode]);

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-background border border-border rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Film className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Episodes</h2>
              {episodes && (
                <Badge variant="outline" className="text-xs">
                  {episodes.length}
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {isLoading && (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading episodes...
              </div>
            )}

            {!isLoading && (!episodes || episodes.length === 0) && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Film className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">No episodes yet. Build one from the timeline.</p>
              </div>
            )}

            {episodes?.map((ep) => {
              const isExporting =
                exportJob?.episodeId === ep.id &&
                (exportStatus as any)?.status !== 'completed' &&
                (exportStatus as any)?.status !== 'failed';
              const isExported =
                !!ep.exportUrl ||
                (exportJob?.episodeId === ep.id && (exportStatus as any)?.status === 'completed');
              const exportFailed =
                exportJob?.episodeId === ep.id && (exportStatus as any)?.status === 'failed';
              const downloadUrl = ep.exportUrl || (exportStatus as any)?.outputUrl;

              return (
                <div
                  key={ep.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card hover:border-muted-foreground/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ep.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px]">
                        {ep.clipCount ?? ep.clips?.length ?? 0} clips
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        ~{Math.round(((ep.clipCount ?? ep.clips?.length ?? 0) * 8) / 60)} min
                      </Badge>
                      {ep.isCanon ? (
                        <Badge className="text-[10px] bg-emerald-500/20 text-emerald-600 border-emerald-500/40">
                          Canon
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] bg-amber-500/20 text-amber-600 border-amber-500/40">
                          Draft
                        </Badge>
                      )}
                      {isExported && (
                        <Badge variant="outline" className="text-[10px] gap-1 text-green-600">
                          <Check className="w-3 h-3" /> Exported
                        </Badge>
                      )}
                      {exportFailed && (
                        <Badge variant="outline" className="text-[10px] gap-1 text-red-600">
                          <AlertCircle className="w-3 h-3" /> Export failed
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPlayingEpisode(ep)}
                      disabled={!ep.clips?.length}
                    >
                      <Play className="w-3.5 h-3.5 mr-1" /> Play
                    </Button>

                    {isExported && downloadUrl ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href={downloadUrl} target="_blank" rel="noreferrer">
                          <Download className="w-3.5 h-3.5 mr-1" /> MP4
                        </a>
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        disabled={isExporting || exportMutation.isPending}
                        onClick={() => exportMutation.mutate(ep.id)}
                      >
                        {isExporting || exportMutation.isPending ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Exporting
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5 mr-1" /> Export
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {exportMutation.error && (
            <div className="px-5 py-2 border-t border-border bg-destructive/10 text-destructive text-xs">
              {(exportMutation.error as Error).message}
            </div>
          )}
        </div>
      </div>

      {/* Sequential playback of the episode's clips */}
      {playingEpisode && playerVideos.length > 0 && (
        <SelectionPlayer videos={playerVideos} onClose={() => setPlayingEpisode(null)} />
      )}
    </>
  );
}

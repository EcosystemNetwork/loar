/**
 * Episode Player — sequential playback of multi-clip episodes.
 *
 * Loads one Firestore episode by id and plays its `clips[]` array as a
 * single continuous experience. When one clip ends, the next auto-plays.
 * The clip list on the side lets viewers jump between parts.
 */

import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { trpcClient } from '@/utils/trpc';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, CheckCircle2, Film, Play, Mic2 } from 'lucide-react';

export const Route = createFileRoute('/episode/$id')({
  component: EpisodePlayer,
});

type EpisodeDoc = {
  id: string;
  universeId: string;
  title?: string;
  description?: string;
  isCanon?: boolean;
  clipCount?: number;
  clips?: Array<{
    nodeId?: string;
    label?: string;
    videoUrl?: string;
    trimStart?: number;
    trimEnd?: number;
  }>;
  sourceCreator?: string | null;
  exportUrl?: string | null;
};

type UniverseDoc = {
  id: string;
  name?: string;
  description?: string;
  image_url?: string;
  imageURL?: string;
};

function EpisodePlayer() {
  const { id } = useParams({ from: '/episode/$id' });

  const { data: episode, isLoading } = useQuery({
    queryKey: ['episode', id],
    queryFn: () => trpcClient.episodes.get.query({ episodeId: id }) as Promise<EpisodeDoc>,
    staleTime: 30_000,
  });

  const universeId = episode?.universeId?.toLowerCase();
  const { data: universeRes } = useQuery({
    queryKey: ['universe', 'episode-player', universeId],
    queryFn: () => trpcClient.universes.get.query({ id: universeId! }),
    enabled: !!universeId,
    staleTime: 60_000,
  });
  const universe = (universeRes as any)?.data as UniverseDoc | undefined;

  const clips = useMemo(
    () => (episode?.clips || []).filter((c) => !!c.videoUrl) as Required<EpisodeDoc>['clips'],
    [episode]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // When the active clip changes, load + play the new source. Browsers ignore
  // autoplay on a fresh <video> in some configurations, so we explicitly call
  // play() and swallow the rejection (e.g. iOS without user gesture).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.load();
    v.play().catch(() => {
      /* autoplay blocked — user can press play */
    });
  }, [activeIndex]);

  // Reset to the first clip whenever the episode itself changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [episode?.id]);

  const handleClipEnded = () => {
    if (activeIndex < clips.length - 1) {
      setActiveIndex((i) => i + 1);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!episode) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-lg text-muted-foreground">Episode not found.</p>
        <Button asChild variant="outline">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-lg text-muted-foreground">This episode has no playable clips yet.</p>
        {universeId && (
          <Button asChild variant="outline">
            <Link to="/universe/$id/watch" params={{ id: universeId }}>
              Back to universe
            </Link>
          </Button>
        )}
      </div>
    );
  }

  const activeClip = clips[activeIndex];
  const universeName = universe?.name || `Universe ${(universeId ?? '').slice(0, 8)}`;
  const universeImage = universe?.image_url || universe?.imageURL || '';

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1440px] mx-auto px-4 md:px-12 py-6">
        {/* Back link */}
        <div className="mb-4">
          {universeId && (
            <Link
              to="/universe/$id/watch"
              params={{ id: universeId }}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              {universeName}
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Player + metadata */}
          <div>
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-black ring-1 ring-white/10">
              <video
                ref={videoRef}
                src={resolveIpfsUrl(activeClip.videoUrl!)}
                className="w-full h-full"
                controls
                playsInline
                onEnded={handleClipEnded}
              />
            </div>

            <div className="mt-4 flex items-start gap-3">
              {universeImage ? (
                <img
                  src={resolveIpfsUrl(universeImage)}
                  alt=""
                  loading="lazy"
                  className="h-12 w-12 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-violet-500/40 to-purple-500/40 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
                    {episode.title || 'Untitled episode'}
                  </h1>
                  {episode.isCanon && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-primary/90 text-primary-foreground px-1.5 py-0.5 rounded flex items-center gap-1">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Canon
                    </span>
                  )}
                  {clips.length > 1 && (
                    <span className="text-[10px] font-semibold bg-white/10 text-white px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Film className="h-2.5 w-2.5" />
                      {clips.length} parts
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{universeName}</p>
              </div>
            </div>

            {episode.description && (
              <p className="mt-4 text-sm md:text-base text-muted-foreground whitespace-pre-wrap leading-relaxed max-w-3xl">
                {episode.description}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/lab/voice-studio"
                search={{ episodeId: id, tab: 'script' as const }}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
              >
                <Mic2 className="h-3.5 w-3.5" />
                Open in Voice Studio
              </Link>
              <Link
                to="/lab/voice-studio"
                search={{ episodeId: id, tab: 'multilingual' as const }}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
              >
                <Film className="h-3.5 w-3.5" />
                Dub to other languages
              </Link>
            </div>
          </div>

          {/* Clip list */}
          <aside className="space-y-2">
            <div className="flex items-end justify-between mb-1">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Parts
              </h2>
              <span className="text-xs text-muted-foreground">
                {activeIndex + 1} / {clips.length}
              </span>
            </div>
            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
              {clips.map((c, i) => {
                const isActive = i === activeIndex;
                return (
                  <button
                    key={c.nodeId ?? `clip-${i}`}
                    onClick={() => setActiveIndex(i)}
                    className={`w-full text-left flex gap-3 p-2 rounded-lg border transition-all ${
                      isActive
                        ? 'border-primary/50 bg-primary/10'
                        : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="relative aspect-video w-24 flex-shrink-0 rounded-md overflow-hidden bg-muted">
                      {c.videoUrl ? (
                        <video
                          src={resolveIpfsUrl(c.videoUrl)}
                          muted
                          preload="metadata"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/40 to-pink-900/40" />
                      )}
                      {isActive && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <Play className="h-4 w-4 text-white fill-white" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium line-clamp-2">
                        {c.label || `Part ${i + 1}`}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                        Part {i + 1} of {clips.length}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

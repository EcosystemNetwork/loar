/**
 * /series — Series Mode flagship.
 *
 * Generate a multi-episode arc with locked cast, style, and visual continuity
 * across all episodes. Higgsfield's shot-by-shot product cannot replicate
 * this without rebuilding their entire pipeline.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth, awaitSessionValidation } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Film, Loader2, Sparkles, Wand2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';

export const Route = createFileRoute('/series')({
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/series' } });
    }
    await awaitSessionValidation();
  },
  component: SeriesPage,
});

type EpisodeStatus = 'queued' | 'running' | 'completed' | 'failed';
type ArcStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

interface ArcEpisode {
  episodeNumber: number;
  generationId: string | null;
  status: EpisodeStatus;
  videoUrl: string | null;
  prompt: string;
  modelUsed: string | null;
  error: string | null;
}

interface Arc {
  id: string;
  status: ArcStatus;
  episodeCount: number;
  premise: string;
  title: string;
  stylePreset: string | null;
  castMemberIds: string[];
  universeId: string | null;
  episodes: ArcEpisode[];
  createdAt: any;
  completedAt: any;
  error: string | null;
}

const STATUS_BADGE: Record<ArcStatus, { label: string; tint: string }> = {
  queued: { label: 'Queued', tint: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' },
  running: { label: 'Running', tint: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  completed: {
    label: 'Completed',
    tint: 'bg-green-500/15 text-green-300 border-green-500/30',
  },
  partial: { label: 'Partial', tint: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  failed: { label: 'Failed', tint: 'bg-red-500/15 text-red-300 border-red-500/30' },
};

function EpisodeIcon({ status }: { status: EpisodeStatus }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-green-400" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function SeriesPage() {
  const { address, isAuthenticated } = useWalletAuth();
  const [premise, setPremise] = useState('');
  const [title, setTitle] = useState('');
  const [episodeCount, setEpisodeCount] = useState(3);
  const [stylePreset, setStylePreset] = useState<string>('none');
  const [universeId, setUniverseId] = useState<string>('none');
  const [castMemberIds, setCastMemberIds] = useState<string[]>([]);
  const [activeArcId, setActiveArcId] = useState<string | null>(null);

  const { data: styles } = useQuery({
    queryKey: ['sceneControls', 'styles'],
    queryFn: () => trpcClient.sceneControls.listStylePresets.query() as Promise<any[]>,
    staleTime: 5 * 60 * 1000,
  });

  // Universes the wallet has created — scope for cast selection
  const { data: myUniverses } = useQuery({
    queryKey: ['universes', 'mine', address],
    queryFn: () =>
      trpcClient.universes.getByCreator
        .query({ creator: address! })
        .then(
          (r: any) => (r?.data ?? r) as Array<{ id: string; name?: string; description?: string }>
        ),
    enabled: !!address && isAuthenticated,
    staleTime: 30_000,
  });

  // Cast members in the selected universe
  const { data: castMembers } = useQuery({
    queryKey: ['cast', 'list', universeId],
    queryFn: () =>
      trpcClient.cast.list.query({ universeId }) as Promise<
        Array<{ id: string; name: string; description: string; referenceImageUrls: string[] }>
      >,
    enabled: universeId !== 'none',
    staleTime: 30_000,
  });

  const toggleCast = (id: string) => {
    setCastMemberIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) {
        toast.error('Maximum 5 cast members per arc');
        return prev;
      }
      return [...prev, id];
    });
  };

  const { data: arcs, refetch: refetchArcs } = useQuery<Arc[]>({
    queryKey: ['seriesArc', 'list'],
    queryFn: () => trpcClient.seriesArc.list.query({ limit: 10 }) as Promise<Arc[]>,
    enabled: isAuthenticated,
    staleTime: 0,
  });

  const { data: activeArc } = useQuery<Arc | null>({
    queryKey: ['seriesArc', 'status', activeArcId],
    queryFn: () =>
      trpcClient.seriesArc.status.query({ arcId: activeArcId! }) as Promise<Arc | null>,
    enabled: !!activeArcId,
    refetchInterval: (q) => {
      const arc = q.state.data as Arc | null | undefined;
      if (!arc) return 3000;
      return arc.status === 'completed' || arc.status === 'partial' || arc.status === 'failed'
        ? false
        : 3000;
    },
  });

  const create = useMutation({
    mutationFn: () =>
      trpcClient.seriesArc.create.mutate({
        premise,
        episodeCount,
        title: title || undefined,
        stylePreset: stylePreset === 'none' ? null : stylePreset,
        universeId: universeId === 'none' ? undefined : universeId,
        castMemberIds: castMemberIds.length > 0 ? castMemberIds : undefined,
      }) as Promise<{ arcId: string; status: string }>,
    onSuccess: (r) => {
      toast.success(`Arc queued — ${episodeCount} episodes generating`);
      setActiveArcId(r.arcId);
      refetchArcs();
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to start arc'),
  });

  const canSubmit = premise.trim().length >= 10 && !create.isPending;

  return (
    <div className="container max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Film className="h-7 w-7 text-purple-400" />
        <div>
          <h1 className="text-2xl font-semibold">Series Mode</h1>
          <p className="text-sm text-muted-foreground">
            One prompt → multiple episodes with locked cast, style, and visual continuity.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Create form */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-medium">Create new arc</h2>
          </div>

          <div>
            <Label htmlFor="title" className="text-xs">
              Title (optional)
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Auto-derived from premise if blank"
              maxLength={200}
            />
          </div>

          <div>
            <Label htmlFor="premise" className="text-xs">
              Premise — the story beat that drives every episode
            </Label>
            <Textarea
              id="premise"
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder="A detective walks through a rain-slicked neon alley, hunting an answer they don't want to find…"
              rows={5}
              maxLength={2000}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {premise.length} / 2000 · minimum 10 chars
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="episodes" className="text-xs">
                Episodes
              </Label>
              <Select
                value={String(episodeCount)}
                onValueChange={(v) => setEpisodeCount(Number(v))}
              >
                <SelectTrigger id="episodes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} episodes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="style" className="text-xs">
                Locked style
              </Label>
              <Select value={stylePreset} onValueChange={setStylePreset}>
                <SelectTrigger id="style">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No style lock</SelectItem>
                  {(styles || []).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="universe" className="text-xs">
              Universe (optional — unlocks cast + wiki context)
            </Label>
            <Select
              value={universeId}
              onValueChange={(v) => {
                setUniverseId(v);
                setCastMemberIds([]);
              }}
            >
              <SelectTrigger id="universe">
                <SelectValue placeholder="No universe scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No universe</SelectItem>
                {(myUniverses || []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name || u.description?.slice(0, 40) || u.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {universeId !== 'none' && (
            <div>
              <Label className="text-xs mb-1.5 block">
                Locked cast (max 5) — appears in every episode
              </Label>
              {castMembers && castMembers.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic">
                  No cast in this universe yet. Add characters in the wiki first.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {(castMembers || []).map((m) => {
                  const selected = castMemberIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleCast(m.id)}
                      className={`flex items-center gap-2 p-2 rounded-md border text-left transition-colors ${
                        selected
                          ? 'border-purple-500/70 bg-purple-500/10'
                          : 'border-border/40 hover:border-purple-500/40'
                      }`}
                    >
                      {m.referenceImageUrls?.[0] ? (
                        <img
                          src={m.referenceImageUrls[0]}
                          alt={m.name}
                          className="h-10 w-10 rounded object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded bg-muted shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{m.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {m.description || 'No description'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {castMemberIds.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  {castMemberIds.length} / 5 cast member{castMemberIds.length === 1 ? '' : 's'}{' '}
                  locked
                </p>
              )}
            </div>
          )}

          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 text-[11px] text-muted-foreground">
            Continuity is locked across episodes via: shared style preset, shared cast reference
            images, universe wiki context, and each episode's last frame anchoring the next
            episode's opening.
          </div>

          <Button className="w-full" disabled={!canSubmit} onClick={() => create.mutate()}>
            {create.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Queuing…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                Generate {episodeCount}-episode arc
              </>
            )}
          </Button>
        </Card>

        {/* Right: Active arc preview */}
        <Card className="p-5 space-y-4 min-h-[300px]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {activeArc ? activeArc.title : 'No arc selected'}
            </h2>
            {activeArc && (
              <Badge variant="outline" className={STATUS_BADGE[activeArc.status].tint}>
                {STATUS_BADGE[activeArc.status].label}
              </Badge>
            )}
          </div>

          {!activeArc && (
            <p className="text-xs text-muted-foreground">
              Submit an arc on the left, or pick one from your recent arcs below.
            </p>
          )}

          {activeArc && (
            <div className="space-y-2">
              {activeArc.episodes.map((ep) => (
                <div
                  key={ep.episodeNumber}
                  className="rounded-md border border-border/40 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <EpisodeIcon status={ep.status} />
                    <span className="text-sm font-medium">Episode {ep.episodeNumber}</span>
                    {ep.modelUsed && (
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                        {ep.modelUsed}
                      </Badge>
                    )}
                  </div>
                  {ep.prompt && (
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{ep.prompt}</p>
                  )}
                  {ep.videoUrl && (
                    <video
                      src={ep.videoUrl}
                      className="w-full rounded border border-border/40"
                      controls
                      preload="metadata"
                    />
                  )}
                  {ep.error && <p className="text-[11px] text-red-400">{ep.error}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Recent arcs */}
      {arcs && arcs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Your recent arcs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {arcs.map((arc) => (
              <Card
                key={arc.id}
                className={`p-4 cursor-pointer hover:border-purple-500/50 ${
                  activeArcId === arc.id ? 'border-purple-500/70' : ''
                }`}
                onClick={() => setActiveArcId(arc.id)}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-medium line-clamp-1 flex-1">{arc.title}</p>
                  <Badge variant="outline" className={STATUS_BADGE[arc.status].tint}>
                    {STATUS_BADGE[arc.status].label}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {arc.episodes.filter((e) => e.status === 'completed').length} / {arc.episodeCount}{' '}
                  episodes ready
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

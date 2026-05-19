/**
 * /virality — Virality Predictor dashboard.
 *
 * Ranks the caller's episodes by composite virality score derived from real
 * watch-session telemetry. Five sub-signals (hook / hold / completion /
 * replay / velocity) feed into one 0–100 index with a plain-English verdict.
 *
 * Higgsfield ships a heuristic "Virality Predictor" — ours is informed by
 * actual viewer data on the platform, not a prompt-only guess. That's the
 * defensible claim.
 */

import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { awaitSessionValidation } from '@/lib/wallet-auth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, Eye, Repeat, Zap, CheckCircle2, Loader2, Flame, Info } from 'lucide-react';

export const Route = createFileRoute('/virality')({
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/virality' } });
    }
    await awaitSessionValidation();
  },
  component: ViralityPage,
});

interface ViralityScore {
  hookScore: number;
  holdRate: number;
  completionRate: number;
  replayRate: number;
  velocity: number;
  viralityIndex: number;
  sampleSize: number;
  uniqueViewers: number;
}

interface EpisodeRow {
  episodeId: string;
  title: string | null;
  universeId: string | null;
  score: ViralityScore;
  description: string;
}

function tintForIndex(idx: number): string {
  if (idx >= 80) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  if (idx >= 60) return 'bg-green-500/15 text-green-300 border-green-500/40';
  if (idx >= 40) return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  if (idx >= 20) return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
  return 'bg-red-500/15 text-red-300 border-red-500/40';
}

function SignalBar({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="font-mono font-medium">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function ViralityPage() {
  const { data, isLoading } = useQuery<EpisodeRow[]>({
    queryKey: ['virality', 'myTopEpisodes'],
    queryFn: () => trpcClient.virality.myTopEpisodes.query({ limit: 20 }) as Promise<EpisodeRow[]>,
    staleTime: 60_000,
  });

  const rows = data || [];
  const hasData = rows.length > 0 && rows.some((r) => r.score.sampleSize > 0);

  return (
    <div className="container max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Flame className="h-7 w-7 text-pink-400" />
          <div>
            <h1 className="text-2xl font-semibold">Virality Predictor</h1>
            <p className="text-sm text-muted-foreground">
              Hook + hold + replay + velocity, blended from real watch-session data.
            </p>
          </div>
        </div>
        <Card className="p-3 border-purple-500/30 bg-purple-500/5 max-w-md">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-purple-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-muted-foreground">
              We score off actual viewer behaviour on the platform — not a prompt-based guess. Score
              updates as new sessions roll in.
            </p>
          </div>
        </Card>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && !hasData && (
        <Card className="p-10 text-center space-y-3">
          <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No watch sessions on your episodes yet. Once viewers start watching, scores will
            populate here automatically.
          </p>
          <Link to="/studio">
            <Button variant="outline">Open Studio</Button>
          </Link>
        </Card>
      )}

      {!isLoading && hasData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows
            .filter((r) => r.score.sampleSize > 0)
            .map((row) => {
              const s = row.score;
              return (
                <Card key={row.episodeId} className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {row.title || row.episodeId.slice(0, 8)}
                      </p>
                      <p className="text-[11px] text-muted-foreground italic mt-0.5">
                        {row.description}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`${tintForIndex(s.viralityIndex)} text-base font-bold px-3 py-1 h-auto shrink-0`}
                    >
                      {s.viralityIndex}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <SignalBar
                      label="Hook"
                      value={s.hookScore}
                      icon={<Zap className="h-3 w-3" />}
                    />
                    <SignalBar label="Hold" value={s.holdRate} icon={<Eye className="h-3 w-3" />} />
                    <SignalBar
                      label="Completion"
                      value={s.completionRate}
                      icon={<CheckCircle2 className="h-3 w-3" />}
                    />
                    <SignalBar
                      label="Replay"
                      value={s.replayRate}
                      icon={<Repeat className="h-3 w-3" />}
                    />
                    <SignalBar
                      label="Velocity"
                      value={s.velocity}
                      icon={<TrendingUp className="h-3 w-3" />}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border/40">
                    <span>
                      {s.sampleSize} session{s.sampleSize === 1 ? '' : 's'} · {s.uniqueViewers}{' '}
                      viewer{s.uniqueViewers === 1 ? '' : 's'}
                    </span>
                    {row.universeId && (
                      <Link
                        to="/analytics/$universeId"
                        params={{ universeId: row.universeId }}
                        className="text-purple-400 hover:underline"
                      >
                        Universe analytics →
                      </Link>
                    )}
                  </div>
                </Card>
              );
            })}
        </div>
      )}

      {!isLoading && hasData && (
        <Card className="p-4 border-border/40 bg-muted/20">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">How it's computed:</span>{' '}
            <span className="font-mono">hook</span> = % of viewers past the 5-second mark ·{' '}
            <span className="font-mono">hold</span> = avg % of the episode watched ·{' '}
            <span className="font-mono">completion</span> = % of sessions marked completed ·{' '}
            <span className="font-mono">replay</span> = % of unique viewers who returned for a 2nd
            session · <span className="font-mono">velocity</span> = normalised sessions/hour since
            publish. Composite weights: 30/30/20/10/10.
          </p>
        </Card>
      )}
    </div>
  );
}

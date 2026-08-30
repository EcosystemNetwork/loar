/**
 * Points leaderboard — who has earned the most activity points.
 *
 * Points are awarded automatically: creating a universe and every
 * generation each add to your score (see server services/points). This
 * page is a read-only ranking; the signed-in user's own standing is
 * pinned above the table.
 *
 * Distinct from `/leaderboard`, which ranks *content* by curator
 * endorsement weight.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Trophy, Globe, Wand2 } from 'lucide-react';

type LeaderboardRow = {
  rank: number;
  userId: string;
  points: number;
  universeCount: number;
  generationCount: number;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

function shortAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function nameFor(row: { displayName: string | null; username: string | null; userId: string }) {
  return row.displayName || (row.username ? `@${row.username}` : shortAddr(row.userId));
}

function medal(rank: number) {
  if (rank === 1) return 'text-amber-400';
  if (rank === 2) return 'text-slate-300';
  if (rank === 3) return 'text-amber-700';
  return 'text-muted-foreground';
}

function PointsLeaderboard() {
  const { address, isAuthenticated } = useWalletAuth();

  const leaderboardQuery = useQuery({
    queryKey: ['points', 'leaderboard'],
    queryFn: () => trpcClient.points.leaderboard.query({ limit: 50 }),
  });

  const configQuery = useQuery({
    queryKey: ['points', 'config'],
    queryFn: () => trpcClient.points.config.query(),
    staleTime: 60 * 60 * 1000,
  });

  const meQuery = useQuery({
    queryKey: ['points', 'me'],
    queryFn: () => trpcClient.points.me.query(),
    enabled: isAuthenticated,
  });

  const rows: LeaderboardRow[] = leaderboardQuery.data?.leaderboard ?? [];
  const me = meQuery.data;
  const perUniverse = configQuery.data?.perUniverse ?? 10;
  const perGeneration = configQuery.data?.perGeneration ?? 10;
  const myAddr = address?.toLowerCase();

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-6 h-6 text-amber-400" />
          <h1 className="text-3xl font-bold tracking-tight">Points Leaderboard</h1>
        </div>
        <p className="text-muted-foreground max-w-2xl">
          Earn points for building. Creating a universe is{' '}
          <span className="font-semibold text-foreground">+{perUniverse}</span>, and every
          generation adds <span className="font-semibold text-foreground">+{perGeneration}</span>.
        </p>
      </div>

      {isAuthenticated && me && (
        <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Your standing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <div className="text-2xl font-bold">{me.rank ? `#${me.rank}` : 'Unranked'}</div>
              <div className="text-xs text-muted-foreground">rank</div>
            </div>
            <div>
              <div className="text-2xl font-bold inline-flex items-center gap-1 text-amber-300">
                <Sparkles className="w-4 h-4" />
                {me.points.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">points</div>
            </div>
            <div className="text-sm text-muted-foreground inline-flex items-center gap-1">
              <Globe className="w-3.5 h-3.5" /> {me.universeCount} universe
              {me.universeCount === 1 ? '' : 's'}
            </div>
            <div className="text-sm text-muted-foreground inline-flex items-center gap-1">
              <Wand2 className="w-3.5 h-3.5" /> {me.generationCount} generation
              {me.generationCount === 1 ? '' : 's'}
            </div>
          </CardContent>
        </Card>
      )}

      {leaderboardQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 py-16 text-center">
          <Sparkles className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">
            No points yet. Create a universe or run a generation to get on the board.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const isMe = !!myAddr && row.userId.toLowerCase() === myAddr;
            return (
              <div
                key={row.userId}
                className={`flex items-center gap-4 rounded-lg border p-4 ${
                  isMe ? 'border-amber-500/40 bg-amber-500/5' : ''
                }`}
              >
                <div className={`w-8 text-center text-xl font-bold ${medal(row.rank)}`}>
                  {row.rank}
                </div>
                {row.avatarUrl ? (
                  <img
                    src={row.avatarUrl}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {nameFor(row)}
                    {isMe && (
                      <Badge variant="outline" className="ml-2 text-[10px] uppercase">
                        You
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {row.universeCount} universe{row.universeCount === 1 ? '' : 's'} ·{' '}
                    {row.generationCount} generation{row.generationCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="inline-flex items-center gap-1 text-amber-300 shrink-0">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="font-semibold">{row.points.toLocaleString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/points-leaderboard')({
  component: PointsLeaderboard,
});

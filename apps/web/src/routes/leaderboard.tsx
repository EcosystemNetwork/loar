/**
 * Leaderboard — aggregate taste signal across entities, universes, and content.
 *
 * Unlike moderation (negative filter), this surfaces what curators actively
 * endorse. Filter by target type or scope to a universe; sort is by total
 * weight, tie-broken by distinct endorser count.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles, Trophy, ExternalLink } from 'lucide-react';

type TargetTypeFilter = 'all' | 'entity' | 'universe' | 'content';

function linkForTarget(targetType: string, targetId: string) {
  if (targetType === 'entity') return { to: '/wiki/entity/$id' as const, params: { id: targetId } };
  if (targetType === 'universe') return { to: '/universe/$id' as const, params: { id: targetId } };
  return null;
}

function Leaderboard() {
  const { type: searchType, universe: searchUniverse } = Route.useSearch();
  const [targetType, setTargetType] = useState<TargetTypeFilter>(searchType ?? 'all');
  const [universeAddress, setUniverseAddress] = useState<string>(searchUniverse ?? '');

  const leaderboardQuery = useQuery({
    queryKey: ['curation', 'leaderboard', targetType, universeAddress],
    queryFn: () =>
      trpcClient.curation.leaderboard.query({
        targetType: targetType === 'all' ? undefined : targetType,
        universeAddress: universeAddress.trim() || undefined,
        limit: 50,
      }),
  });

  const entries = leaderboardQuery.data?.leaderboard ?? [];

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-6 h-6 text-amber-400" />
          <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
        </div>
        <p className="text-muted-foreground max-w-2xl">
          What curators think is worth looking at. Aggregate endorsement weight per target,
          tied-broken by distinct endorser count. This is a positive taste layer — separate from
          moderation.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Target type</Label>
            <Select value={targetType} onValueChange={(v) => setTargetType(v as TargetTypeFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All targets</SelectItem>
                <SelectItem value="entity">Entities</SelectItem>
                <SelectItem value="universe">Universes</SelectItem>
                <SelectItem value="content">Content</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Scope to universe (optional)</Label>
            <Input
              value={universeAddress}
              onChange={(e) => setUniverseAddress(e.target.value)}
              placeholder="0x..."
            />
          </div>
        </CardContent>
      </Card>

      {leaderboardQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 py-16 text-center">
          <Sparkles className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">
            No endorsements yet. Be the first — endorse anything you think is worth looking at.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e: any, idx: number) => {
            const link = linkForTarget(e.targetType, e.targetId);
            const inner = (
              <div className="flex items-center gap-4">
                <div className="w-10 text-center text-2xl font-bold text-muted-foreground">
                  {idx + 1}
                </div>
                <Badge variant="outline" className="uppercase text-[10px]">
                  {e.targetType}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm truncate">{e.targetId}</div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="inline-flex items-center gap-1 text-amber-300">
                    <Sparkles className="w-3 h-3" />
                    <span className="font-semibold">{e.score}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {e.endorsers} curator{e.endorsers === 1 ? '' : 's'}
                  </span>
                  {link && <ExternalLink className="w-3 h-3 text-muted-foreground" />}
                </div>
              </div>
            );
            return link ? (
              <Link
                key={`${e.targetType}-${e.targetId}`}
                to={link.to}
                params={link.params as any}
                className="block rounded-lg border p-4 hover:border-primary/40 hover:bg-accent/20 transition-colors"
              >
                {inner}
              </Link>
            ) : (
              <div key={`${e.targetType}-${e.targetId}`} className="rounded-lg border p-4">
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const leaderboardSearchSchema = z.object({
  type: z.enum(['all', 'entity', 'universe', 'content']).optional(),
  universe: z.string().optional(),
});

export const Route = createFileRoute('/leaderboard')({
  component: Leaderboard,
  validateSearch: leaderboardSearchSchema,
});

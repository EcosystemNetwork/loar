/**
 * /admin/mainnet — Mainnet Readiness Scorecard.
 *
 * Live status of every blocker tracked in docs/launch-readiness.md.
 * Env-var-driven checks update as ops sets values on Railway / Vercel.
 * External/legal items are surfaced as a checklist with concrete next steps.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  Rocket,
  Shield,
  Wrench,
  Gavel,
  AlertCircle,
  RefreshCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/admin/mainnet')({
  component: MainnetReadinessPage,
});

type BlockerStatus = 'ready' | 'blocked' | 'unknown';
type BlockerCategory = 'operational' | 'external' | 'code' | 'legal';

interface Blocker {
  id: string;
  category: BlockerCategory;
  title: string;
  description: string;
  owner: string;
  effort: string;
  nextStep: string;
  docAnchor?: string;
  status: BlockerStatus;
}

interface Snapshot {
  totalBlockers: number;
  readyCount: number;
  blockedCount: number;
  unknownCount: number;
  byCategory: Record<BlockerCategory, { ready: number; blocked: number; unknown: number }>;
  blockers: Blocker[];
  generatedAt: string;
}

const CATEGORY_ICON: Record<BlockerCategory, React.ReactNode> = {
  operational: <Wrench className="h-4 w-4 text-blue-400" />,
  external: <Shield className="h-4 w-4 text-purple-400" />,
  code: <AlertCircle className="h-4 w-4 text-amber-400" />,
  legal: <Gavel className="h-4 w-4 text-pink-400" />,
};

const STATUS_TINT: Record<BlockerStatus, string> = {
  ready: 'bg-green-500/15 text-green-300 border-green-500/40',
  blocked: 'bg-red-500/15 text-red-300 border-red-500/40',
  unknown: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40',
};

function StatusIcon({ status }: { status: BlockerStatus }) {
  if (status === 'ready') return <CheckCircle2 className="h-4 w-4 text-green-400" />;
  if (status === 'blocked') return <XCircle className="h-4 w-4 text-red-400" />;
  return <HelpCircle className="h-4 w-4 text-zinc-400" />;
}

function MainnetReadinessPage() {
  const { data, isLoading, refetch, isRefetching } = useQuery<Snapshot>({
    queryKey: ['mainnetReadiness', 'snapshot'],
    queryFn: () => trpcClient.mainnetReadiness.snapshot.query() as Promise<Snapshot>,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-sm text-muted-foreground">Loading readiness snapshot…</p>
      </div>
    );
  }
  if (!data) return null;

  const byCategory: Record<BlockerCategory, Blocker[]> = {
    operational: [],
    external: [],
    code: [],
    legal: [],
  };
  for (const b of data.blockers) byCategory[b.category].push(b);

  // Sort each category: blocked first, then unknown, then ready
  const order: Record<BlockerStatus, number> = { blocked: 0, unknown: 1, ready: 2 };
  (Object.keys(byCategory) as BlockerCategory[]).forEach((c) =>
    byCategory[c].sort((a, b) => order[a.status] - order[b.status])
  );

  const overallPct = Math.round((data.readyCount / data.totalBlockers) * 100);

  return (
    <div className="container max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Rocket className="h-7 w-7 text-pink-400" />
          <div>
            <h1 className="text-2xl font-semibold">Mainnet Readiness</h1>
            <p className="text-sm text-muted-foreground">
              Live scorecard of launch blockers. Env-var checks update as ops sets values; legal /
              external items show the next step.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={isRefetching} onClick={() => refetch()}>
          <RefreshCcw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Headline scorecard */}
      <Card className="p-6 space-y-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-4xl font-bold">{overallPct}%</p>
          <p className="text-sm text-muted-foreground">
            {data.readyCount} / {data.totalBlockers} blockers cleared
          </p>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${(data.readyCount / data.totalBlockers) * 100}%` }}
          />
          <div
            className="bg-zinc-500 transition-all"
            style={{ width: `${(data.unknownCount / data.totalBlockers) * 100}%` }}
          />
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${(data.blockedCount / data.totalBlockers) * 100}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-3 text-[11px]">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> {data.readyCount} ready
          </span>
          <span className="flex items-center gap-1.5">
            <HelpCircle className="h-3.5 w-3.5 text-zinc-400" /> {data.unknownCount} manual
          </span>
          <span className="flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 text-red-400" /> {data.blockedCount} blocked
          </span>
        </div>
      </Card>

      {/* Per-category breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(Object.keys(data.byCategory) as BlockerCategory[]).map((c) => {
          const cat = data.byCategory[c];
          const total = cat.ready + cat.blocked + cat.unknown;
          if (total === 0) return null;
          return (
            <Card key={c} className="p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                {CATEGORY_ICON[c]}
                <p className="text-xs capitalize font-medium">{c}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {cat.ready} / {total} ready
              </p>
            </Card>
          );
        })}
      </div>

      {/* Detail by category */}
      {(['operational', 'legal', 'external', 'code'] as BlockerCategory[]).map((c) => {
        const items = byCategory[c];
        if (items.length === 0) return null;
        return (
          <div key={c} className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground capitalize flex items-center gap-2">
              {CATEGORY_ICON[c]}
              {c} ({items.length})
            </h2>
            <div className="grid grid-cols-1 gap-2">
              {items.map((b) => (
                <Card key={b.id} className="p-4 space-y-2">
                  <div className="flex items-start gap-3">
                    <StatusIcon status={b.status} />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{b.title}</p>
                        <Badge
                          variant="outline"
                          className={`text-[9px] h-4 px-1.5 ${STATUS_TINT[b.status]}`}
                        >
                          {b.status}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-mono">
                          {b.id}
                        </Badge>
                        {b.docAnchor && (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1.5 font-mono">
                            doc: {b.docAnchor}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5 capitalize">
                          owner: {b.owner}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5 capitalize">
                          {b.effort}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{b.description}</p>
                      <div className="rounded-md border border-border/40 bg-muted/20 p-2 text-[11px]">
                        <span className="font-medium">Next step:</span> {b.nextStep}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      <p className="text-[10px] text-muted-foreground text-center">
        Source of truth: <span className="font-mono">docs/launch-readiness.md</span>. Snapshot
        generated {new Date(data.generatedAt).toLocaleString()}.
      </p>
    </div>
  );
}

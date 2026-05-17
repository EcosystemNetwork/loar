/**
 * Brand Dashboard — A3 from prd-ad-placements.md
 *
 * Brand-side view of active sponsorships, bids placed, and impression
 * performance. Sources entirely off existing public/protected getters:
 *   - ads.mySponsorships (auth required) — active deals
 *   - ads.getBids (per-slot) — historical bids placed by this wallet
 *
 * No on-chain reads here — the brand cares about $ spent vs impressions
 * delivered, which is the off-chain bookkeeping layer.
 */
import { createFileRoute, redirect, Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, Eye, Megaphone, DollarSign, AlertTriangle, Plus } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { awaitSessionValidation } from '@/lib/wallet-auth';
import { formatEther } from 'viem';

export const Route = createFileRoute('/brand/dashboard')({
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/brand/dashboard' } });
    }
    await awaitSessionValidation();
  },
  component: BrandDashboardPage,
});

interface Sponsorship {
  id: string;
  slotId: string;
  universeId: string;
  sponsorUid: string;
  placementType: string;
  totalPaid: string;
  impressions: number;
  episodesRemaining: number;
  active: boolean;
  creativeStatus?: 'pending' | 'approved' | 'flagged' | 'rejected';
  creativeRejectionReason?: string;
  startedAt?: { _seconds?: number } | string;
}

function formatWeiAsEth(wei: string | number | undefined): string {
  if (!wei) return '0';
  try {
    return parseFloat(formatEther(BigInt(wei))).toFixed(4);
  } catch {
    return String(wei);
  }
}

function tsOf(v: Sponsorship['startedAt']): number {
  if (!v) return 0;
  if (typeof v === 'object' && '_seconds' in v && typeof v._seconds === 'number') {
    return v._seconds * 1000;
  }
  if (typeof v === 'string') return new Date(v).getTime();
  return 0;
}

function StatusBadge({ status }: { status: Sponsorship['creativeStatus'] }) {
  if (!status || status === 'approved')
    return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Live</Badge>;
  if (status === 'pending')
    return (
      <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
        Pending review
      </Badge>
    );
  if (status === 'flagged')
    return <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">Flagged</Badge>;
  return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Rejected</Badge>;
}

function BrandDashboardPage() {
  const sponsorshipsQuery = useQuery({
    queryKey: ['brand', 'sponsorships'],
    queryFn: () => trpcClient.ads.mySponsorships.query() as Promise<Sponsorship[]>,
  });

  const sponsorships = useMemo(() => {
    const list = sponsorshipsQuery.data ?? [];
    return [...list].sort((a, b) => tsOf(b.startedAt) - tsOf(a.startedAt));
  }, [sponsorshipsQuery.data]);

  const totals = useMemo(() => {
    let totalSpentWei = 0n;
    let totalImpressions = 0;
    let activeCount = 0;
    for (const s of sponsorships) {
      try {
        totalSpentWei += BigInt(s.totalPaid ?? '0');
      } catch {
        /* skip non-numeric */
      }
      totalImpressions += s.impressions ?? 0;
      if (s.active && (s.creativeStatus ?? 'approved') === 'approved') activeCount += 1;
    }
    return {
      totalSpentEth: parseFloat(formatEther(totalSpentWei)).toFixed(4),
      totalImpressions,
      activeCount,
    };
  }, [sponsorships]);

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Megaphone className="h-8 w-8 text-primary" />
              <h1 className="text-3xl md:text-4xl font-bold">Brand Dashboard</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Track active sponsorships, bids, and impression delivery.
            </p>
          </div>
          <Link to="/adplacements">
            <Button>
              <Plus className="h-4 w-4 mr-1.5" />
              Find more slots
            </Button>
          </Link>
        </div>

        {/* Headline stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <StatCard
            icon={<DollarSign className="h-5 w-5" />}
            label="Total Spend"
            value={`${totals.totalSpentEth} ETH`}
          />
          <StatCard
            icon={<Eye className="h-5 w-5" />}
            label="Impressions Delivered"
            value={totals.totalImpressions.toLocaleString()}
          />
          <StatCard
            icon={<TrendingUp className="h-5 w-5" />}
            label="Active Sponsorships"
            value={String(totals.activeCount)}
          />
        </div>

        {/* Sponsorships table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Sponsorships</CardTitle>
          </CardHeader>
          <CardContent>
            {sponsorshipsQuery.isLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!sponsorshipsQuery.isLoading && sponsorships.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm mb-2">You don't have any active sponsorships yet.</p>
                <Link to="/adplacements">
                  <Button variant="outline" size="sm">
                    Browse open slots
                  </Button>
                </Link>
              </div>
            )}

            {sponsorships.length > 0 && (
              <div className="space-y-2">
                {sponsorships.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border/40 hover:border-border/80 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Link
                          to="/adplacements/$slotId"
                          params={{ slotId: s.slotId }}
                          search={{
                            universeId: s.universeId,
                            placementType: s.placementType,
                            minBid: '0',
                            currentBid: s.totalPaid,
                            currentBidder: '',
                            description: '',
                            constraints: '',
                            episodes: s.episodesRemaining,
                            creatorUid: '',
                            active: s.active,
                          }}
                          className="text-sm font-medium hover:text-primary truncate"
                        >
                          {s.placementType} — Slot {s.slotId.slice(0, 8)}…
                        </Link>
                        <StatusBadge status={s.creativeStatus} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Universe {s.universeId.slice(0, 10)}… • {s.episodesRemaining} episodes left
                      </p>
                      {s.creativeStatus === 'rejected' && s.creativeRejectionReason && (
                        <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {s.creativeRejectionReason}
                        </p>
                      )}
                    </div>
                    <div className="text-right ml-4 shrink-0">
                      <p className="text-sm font-medium">{formatWeiAsEth(s.totalPaid)} ETH</p>
                      <p className="text-xs text-muted-foreground">
                        {s.impressions.toLocaleString()} impressions
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3 mb-2 text-muted-foreground">
          {icon}
          <span className="text-xs uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

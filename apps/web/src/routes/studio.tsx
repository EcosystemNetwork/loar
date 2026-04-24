/**
 * Studio — Producer command center.
 *
 * Lists universes the connected wallet created, with quick entry points
 * into the editor, access settings, analytics, and the public watch page.
 * Separates the producer flow from the consumer (Netflix-style) landing.
 */

import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth, awaitSessionValidation } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import {
  ponderGql,
  ponderQueryDefaults,
  type Universe as PonderUniverse,
  type Token as PonderToken,
} from '@/utils/ponder-api';
import type { FirestoreUniverse } from '@/types/firestore';
import { Plus, Settings, BarChart3, Eye, Film, Loader2, Wand2, Coins, Layers } from 'lucide-react';

export const Route = createFileRoute('/studio')({
  // WEB-6: await /auth/me before studio mutations become reachable.
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/studio' } });
    }
    await awaitSessionValidation();
  },
  component: StudioPage,
});

type StudioUniverse = FirestoreUniverse & {
  nodeCount?: number;
  tokenSymbol?: string;
  tokenAddress?: string;
};

function StudioPage() {
  const { address, isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = useNavigate();

  const { data: mine, isLoading } = useQuery({
    queryKey: ['studio', 'universes', address],
    queryFn: () =>
      trpcClient.universes.getByCreator
        .query({ creator: address! })
        .then((r: any) => (r?.data ?? r) as FirestoreUniverse[]),
    enabled: !!address && isAuthenticated,
    staleTime: 15_000,
  });

  const ids = useMemo(() => (mine || []).map((u) => u.id.toLowerCase()), [mine]);

  const { data: ponderUniverses } = useQuery({
    queryKey: ['studio', 'ponder-enrich', ids.join(',')],
    queryFn: () =>
      ponderGql<{ universes: { items: PonderUniverse[] } }>(`{
        universes(limit: 200) {
          items { id nodeCount tokenAddress }
        }
      }`).then((d) => d.universes.items),
    ...ponderQueryDefaults,
    enabled: ids.length > 0,
  });

  const { data: tokens } = useQuery({
    queryKey: ['studio', 'tokens', ids.join(',')],
    queryFn: () =>
      ponderGql<{ tokens: { items: PonderToken[] } }>(`{
        tokens(limit: 500) {
          items { id universeAddress symbol name imageURL }
        }
      }`).then((d) => d.tokens.items),
    ...ponderQueryDefaults,
    enabled: ids.length > 0,
  });

  const enriched: StudioUniverse[] = useMemo(() => {
    const byId = new Map<string, PonderUniverse>();
    (ponderUniverses || []).forEach((u) => byId.set(u.id.toLowerCase(), u));
    const tokenById = new Map<string, PonderToken>();
    (tokens || []).forEach((t) => tokenById.set(t.universeAddress.toLowerCase(), t));
    return (mine || []).map((u) => {
      const p = byId.get(u.id.toLowerCase());
      const t = tokenById.get(u.id.toLowerCase());
      return {
        ...u,
        nodeCount: p?.nodeCount ?? 0,
        tokenSymbol: t?.symbol,
        tokenAddress: t?.id || u.tokenAddress,
      };
    });
  }, [mine, ponderUniverses, tokens]);

  if (isAuthenticating || (isAuthenticated && isLoading)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const totalEpisodes = enriched.reduce((sum, u) => sum + (u.nodeCount || 0), 0);
  const tokenized = enriched.filter(
    (u) => u.tokenAddress && u.tokenAddress !== '0x0000000000000000000000000000000000000000'
  ).length;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ────────────────────────────────────── */}
      <div className="border-b border-white/5 bg-gradient-to-b from-primary/5 to-transparent">
        <div className="max-w-[1440px] mx-auto px-4 md:px-8 py-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-primary/80 mb-2">Studio</p>
              <h1 className="text-3xl md:text-4xl font-display italic text-foreground">
                Your universes
              </h1>
              <p className="text-sm text-muted-foreground mt-2 max-w-xl">
                Manage every universe you've launched. Open the editor, tune access, track revenue,
                or preview the public watch page.
              </p>
            </div>
            <Button asChild size="lg" className="rounded-full px-6">
              <Link to="/cinematicUniverseCreate">
                <Plus className="h-4 w-4 mr-2" />
                New universe
              </Link>
            </Button>
          </div>

          {enriched.length > 0 && (
            <div className="mt-6 grid grid-cols-3 gap-4 max-w-md">
              <Stat label="Universes" value={enriched.length} icon={Layers} />
              <Stat label="Episodes" value={totalEpisodes} icon={Film} />
              <Stat label="Tokenized" value={tokenized} icon={Coins} />
            </div>
          )}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────── */}
      <div className="max-w-[1440px] mx-auto px-4 md:px-8 py-8">
        {enriched.length === 0 ? (
          <EmptyState onCreate={() => navigate({ to: '/cinematicUniverseCreate' })} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {enriched.map((u) => (
              <StudioCard key={u.id} universe={u} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold text-foreground tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function StudioCard({ universe: u }: { universe: StudioUniverse }) {
  const cover = u.image_url || u.imageURL;
  const title = u.name || `Universe ${u.id.slice(0, 8)}`;
  const hasToken =
    u.tokenAddress && u.tokenAddress !== '0x0000000000000000000000000000000000000000';

  return (
    <Card className="overflow-hidden group bg-white/[0.02] border-white/5 hover:border-primary/40 transition-all">
      {/* Art */}
      <Link to="/universe/$id" params={{ id: u.id }} className="block">
        <div className="relative aspect-video bg-muted overflow-hidden">
          {cover ? (
            <img
              src={resolveIpfsUrl(cover)}
              alt=""
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-amber-900/60 via-stone-900 to-stone-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
            <h3 className="text-white font-semibold text-base truncate drop-shadow">{title}</h3>
            <div className="flex gap-1 flex-shrink-0">
              {(u.nodeCount ?? 0) > 0 && (
                <Badge className="bg-green-500/90 text-white text-[10px] border-0">
                  {u.nodeCount} EP
                </Badge>
              )}
              {u.tokenSymbol && (
                <Badge className="bg-primary/90 text-white text-[10px] border-0">
                  ${u.tokenSymbol}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Link>

      {/* Description */}
      {u.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 px-4 pt-3">{u.description}</p>
      )}

      {/* Actions */}
      <div className="p-4 pt-3 grid grid-cols-2 gap-2">
        <Button asChild size="sm" className="gap-1.5">
          <Link to="/universe/$id" params={{ id: u.id }}>
            <Wand2 className="h-3.5 w-3.5" />
            Edit
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to="/universe/$id/watch" params={{ id: u.id }}>
            <Eye className="h-3.5 w-3.5" />
            Watch page
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
          <Link to="/analytics/$universeId" params={{ universeId: u.id }}>
            <BarChart3 className="h-3.5 w-3.5" />
            Analytics
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
          <Link to="/universe/$id" params={{ id: u.id }} search={{ panel: 'access' } as any}>
            <Settings className="h-3.5 w-3.5" />
            Access
          </Link>
        </Button>
      </div>

      {hasToken && (
        <Link
          to="/tokens/$address"
          params={{ address: u.tokenAddress! }}
          className="block border-t border-white/5 px-4 py-2 text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center justify-between"
        >
          <span className="flex items-center gap-1.5">
            <Coins className="h-3 w-3" />
            Token page
          </span>
          <span className="font-mono">
            {u.tokenAddress!.slice(0, 6)}…{u.tokenAddress!.slice(-4)}
          </span>
        </Link>
      )}
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-24 border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 mx-auto flex items-center justify-center mb-4">
        <Plus className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No universes yet</h3>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
        Your studio is empty. Launch your first narrative universe to unlock the editor, token
        launchpad, and revenue tools.
      </p>
      <Button size="lg" onClick={onCreate} className="rounded-full px-6">
        <Plus className="h-4 w-4 mr-2" />
        Create your first universe
      </Button>
    </div>
  );
}

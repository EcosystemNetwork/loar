/**
 * Universe Profile Page — public landing for a single universe.
 *
 * Renders the off-chain profile (name, description, cover, portrait) plus
 * surface stats (episode count, token symbol, public/private status). The
 * editor lives at `/universe/$id`; the consumer-facing player is at
 * `/universe/$id/watch`. This page is the front door — the first thing
 * casual visitors and discoverers see.
 *
 * Owner controls (creator or current Safe multi-sig signer) gate an
 * "Edit profile" button that opens `UniverseProfileEditor`. Server enforces
 * authorization via `universes.updateMetadata` and `universes.setPrivate`,
 * so the UI gate is purely cosmetic — non-owners simply don't see the button.
 */

import { useState } from 'react';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Eye,
  EyeOff,
  Film,
  Globe,
  Pencil,
  Play,
  Settings,
  Share2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { trpcClient } from '@/utils/trpc';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import {
  ponderGql,
  ponderQueryDefaults,
  type Token as PonderToken,
  type Universe as PonderUniverse,
} from '@/utils/ponder-api';
import { useIsUniverseAdmin } from '@/hooks/useIsUniverseAdmin';
import { UniverseProfileEditor } from '@/components/UniverseProfileEditor';

export const Route = createFileRoute('/universe/$id/profile')({
  component: UniverseProfilePage,
});

function shortenAddress(addr?: string | null): string {
  if (!addr) return '—';
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function UniverseProfilePage() {
  const { id } = useParams({ from: '/universe/$id/profile' });
  const idLower = id.toLowerCase();
  const [editorOpen, setEditorOpen] = useState(false);

  const universeQuery = useQuery({
    queryKey: ['universe', 'profile', idLower],
    queryFn: () =>
      trpcClient.universes.get
        .query({ id: idLower })
        .then((r: any) => (r?.data ?? r) as Record<string, any> | null),
  });

  const universe = universeQuery.data;
  const isOnChain = (universe?.universeType ?? 'monetized') !== 'fun';

  const ponderUniverseQuery = useQuery({
    queryKey: ['universe', 'profile', 'ponder', idLower],
    queryFn: () =>
      ponderGql<{ universe: PonderUniverse | null }>(`{
        universe(id: "${idLower}") { id nodeCount tokenAddress }
      }`).then((d) => d.universe),
    ...ponderQueryDefaults,
    enabled: isOnChain,
  });

  const offChainNodesQuery = useQuery({
    queryKey: ['universe', 'profile', 'offchain', idLower],
    queryFn: () =>
      trpcClient.offChainNodes.list.query({ universeId: idLower }) as Promise<{
        total: number;
      }>,
    enabled: !!universe && !isOnChain,
    staleTime: 30_000,
  });

  const tokenQuery = useQuery({
    queryKey: ['universe', 'profile', 'token', idLower],
    queryFn: () =>
      ponderGql<{ tokens: { items: PonderToken[] } }>(`{
        tokens(where: { universeAddress: "${idLower}" }, limit: 1) {
          items { id symbol name imageURL }
        }
      }`).then((d) => d.tokens.items[0] ?? null),
    ...ponderQueryDefaults,
    enabled: isOnChain,
  });

  const admin = useIsUniverseAdmin(idLower as `0x${string}`);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ url, title: universe?.name ?? 'Universe' });
        return;
      } catch {
        // User cancelled — fall through to clipboard copy.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Could not copy link');
    }
  };

  if (universeQuery.isLoading) {
    return (
      <div className="container mx-auto max-w-5xl space-y-6 px-4 py-10">
        <Skeleton className="h-72 w-full rounded-lg" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!universe) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold">Universe not found</h1>
        <p className="mt-2 text-muted-foreground">
          {universeQuery.error instanceof Error
            ? universeQuery.error.message
            : 'This universe may be private or has been removed.'}
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    );
  }

  const name = (universe.name as string | undefined) ?? `Universe ${idLower.slice(0, 8)}`;
  const description = (universe.description as string | undefined) ?? '';
  const cover =
    (universe.image_url as string | undefined) ?? (universe.imageURL as string | undefined);
  const portrait = universe.portrait_image_url as string | undefined;
  const creator = (universe.creator as string | undefined) ?? undefined;
  const universeType: 'fun' | 'monetized' = (universe.universeType as any) ?? 'monetized';
  const isPrivate = Boolean(universe.isPrivate);
  const unstoppableDomain = universe.unstoppableDomain as string | undefined;

  const episodeCount = isOnChain
    ? Number(ponderUniverseQuery.data?.nodeCount ?? 0)
    : Number(offChainNodesQuery.data?.total ?? 0);
  const token = tokenQuery.data;
  const isOwner = admin.isAdmin && !admin.isLoading;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative">
        <div className="relative h-[42vh] min-h-[320px] w-full overflow-hidden">
          {cover ? (
            <img src={resolveIpfsUrl(cover)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-amber-900/60 via-stone-900 to-stone-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
        </div>

        <div className="container relative mx-auto max-w-5xl -mt-24 px-4 pb-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
            <div className="flex-shrink-0">
              <div className="h-32 w-32 overflow-hidden rounded-2xl border-4 border-black bg-stone-900 shadow-2xl sm:h-40 sm:w-40">
                {portrait ? (
                  <img
                    src={resolveIpfsUrl(portrait)}
                    alt={name}
                    className="h-full w-full object-cover"
                  />
                ) : cover ? (
                  <img
                    src={resolveIpfsUrl(cover)}
                    alt={name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-stone-500">
                    <Sparkles className="h-10 w-10" />
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-3 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    universeType === 'monetized'
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  }
                >
                  {universeType === 'monetized' ? 'Launchpad' : 'Sandbox'}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    isPrivate
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  }
                >
                  {isPrivate ? (
                    <>
                      <EyeOff className="mr-1 h-3 w-3" /> Private
                    </>
                  ) : (
                    <>
                      <Eye className="mr-1 h-3 w-3" /> Public
                    </>
                  )}
                </Badge>
                {token?.symbol && (
                  <Badge className="border-0 bg-primary/80 text-white">${token.symbol}</Badge>
                )}
                {episodeCount > 0 && (
                  <Badge variant="outline" className="border-white/20 bg-white/5 text-white">
                    <Film className="mr-1 h-3 w-3" />
                    {episodeCount} episode{episodeCount === 1 ? '' : 's'}
                  </Badge>
                )}
              </div>

              <h1 className="font-display text-3xl tracking-tight sm:text-4xl md:text-5xl">
                {name}
              </h1>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/60">
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  by {shortenAddress(creator)}
                </span>
                {unstoppableDomain && (
                  <span className="font-mono text-emerald-400">{unstoppableDomain}</span>
                )}
              </div>
            </div>
          </div>

          {/* CTAs */}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild size="lg" className="rounded-full px-6">
              <Link to="/universe/$id/watch" params={{ id: idLower }}>
                <Play className="mr-2 h-4 w-4 fill-current" />
                Watch
              </Link>
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="rounded-full bg-white/10 text-white hover:bg-white/20"
              onClick={handleShare}
            >
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
            {isOwner && (
              <>
                <Button
                  variant="outline"
                  size="lg"
                  className="rounded-full border-white/20 bg-white/5 text-white hover:bg-white/15"
                  onClick={() => setEditorOpen(true)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit profile
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="rounded-full border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                >
                  <Link to="/universe/$id" params={{ id: idLower }}>
                    <Wand2 className="mr-2 h-4 w-4" />
                    Open editor
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Body ───────────────────────────────────────────────── */}
      <section className="container mx-auto max-w-5xl px-4 pb-16">
        <div className="grid gap-8 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white/60">About</h2>
            {description ? (
              <p className="whitespace-pre-wrap text-base leading-relaxed text-white/85">
                {description}
              </p>
            ) : (
              <p className="text-sm italic text-white/50">
                {isOwner
                  ? 'No description yet. Click "Edit profile" to add one.'
                  : 'No description yet.'}
              </p>
            )}
          </div>

          <aside className="space-y-4 rounded-lg border border-white/10 bg-white/[0.02] p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">Details</h3>
            <Detail label="Type" value={universeType === 'monetized' ? 'Launchpad' : 'Sandbox'} />
            <Detail label="Visibility" value={isPrivate ? 'Private' : 'Public'} />
            <Detail label="Episodes" value={String(episodeCount)} />
            {token?.symbol && <Detail label="Token" value={`$${token.symbol}`} />}
            <Detail label="Creator" value={shortenAddress(creator)} mono />
            <Detail label="Universe" value={shortenAddress(idLower)} mono />
            {unstoppableDomain && <Detail label="Domain" value={unstoppableDomain} mono />}

            {isOwner && (
              <div className="border-t border-white/10 pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs text-white/70"
                  onClick={() => setEditorOpen(true)}
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Profile settings
                </Button>
              </div>
            )}
          </aside>
        </div>
      </section>

      {isOwner && (
        <UniverseProfileEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          universe={{
            id: idLower,
            name: universe.name as string | undefined,
            description: universe.description as string | undefined,
            image_url: universe.image_url as string | undefined,
            portrait_image_url: universe.portrait_image_url as string | undefined,
            isPrivate: Boolean(universe.isPrivate),
            universeType,
          }}
        />
      )}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-white/50">{label}</span>
      <span className={mono ? 'font-mono text-xs text-white/85' : 'text-white/85'}>{value}</span>
    </div>
  );
}

/**
 * /marketplace/likeness — Verified Likeness Marketplace browse page.
 *
 * Filters: kind (voice / likeness), modality, deal type (BUY / LEASE /
 * LICENSE), full-text search across title + description, and sort by
 * newest / price / popularity. Cards link into /marketplace/likeness/$id.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Mic, Sparkles, Search, ShieldCheck, BadgeCheck, UserCircle2 } from 'lucide-react';
import { formatEther } from 'viem';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  LIKENESS_DEAL_TYPES,
  LIKENESS_MODALITIES,
  type LikenessDealType,
  type LikenessModality,
} from '@/hooks/useEntities';

export const Route = createFileRoute('/marketplace/likeness')({
  component: LikenessMarketplacePage,
});

interface BrowseListing {
  id: string;
  entityId: string;
  entityKind: 'voice' | 'likeness' | 'persona';
  title: string;
  description: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  modalities: LikenessModality[];
  buyPriceWei: string;
  leasePricePerDayWei: string;
  licenseFeeWei: string;
  totalSales: number;
}

function formatEthDisplay(wei: string): string {
  if (wei === '0') return '—';
  try {
    const eth = Number(formatEther(BigInt(wei)));
    if (eth >= 1) return `${eth.toFixed(2)} ETH`;
    if (eth >= 0.001) return `${eth.toFixed(4)} ETH`;
    return `${eth.toFixed(6)} ETH`;
  } catch {
    return '?';
  }
}

function LikenessMarketplacePage() {
  const [kind, setKind] = useState<'voice' | 'likeness' | 'persona' | null>(null);
  const [modality, setModality] = useState<LikenessModality | null>(null);
  const [dealType, setDealType] = useState<LikenessDealType | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc' | 'popular'>('newest');

  const { data, isLoading } = useQuery({
    queryKey: ['likenessMarketplace', 'browse', kind, modality, dealType, search, sortBy],
    queryFn: () =>
      trpcClient.likenessMarketplace.browse.query({
        kind: kind ?? undefined,
        modality: modality ?? undefined,
        dealType: dealType ?? undefined,
        search: search || undefined,
        sortBy,
        limit: 30,
      }),
  });

  const listings = (data?.listings ?? []) as BrowseListing[];

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="size-5 text-primary" />
          <Badge variant="secondary" className="text-[10px]">
            Verified Likeness Marketplace
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Voice & Likeness Marketplace</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          License voice and likeness from real creators. Buy permanently, lease by the day, or
          license with royalties. Every listing is consent-attested by the rights holder.
        </p>
      </header>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search voices and likenesses…"
            className="pl-9"
          />
        </div>

        {/* Kind */}
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={kind === null ? 'default' : 'outline'}
            onClick={() => setKind(null)}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={kind === 'voice' ? 'default' : 'outline'}
            onClick={() => setKind('voice')}
          >
            <Mic className="size-3.5 mr-1" />
            Voices
          </Button>
          <Button
            size="sm"
            variant={kind === 'likeness' ? 'default' : 'outline'}
            onClick={() => setKind('likeness')}
          >
            <Sparkles className="size-3.5 mr-1" />
            Likenesses
          </Button>
          <Button
            size="sm"
            variant={kind === 'persona' ? 'default' : 'outline'}
            onClick={() => setKind('persona')}
          >
            <UserCircle2 className="size-3.5 mr-1" />
            Personas
          </Button>
        </div>

        {/* Deal type */}
        <div className="flex gap-1">
          {(['BUY', 'LEASE', 'LICENSE'] as const).map((dt) => (
            <Button
              key={dt}
              size="sm"
              variant={dealType === dt ? 'default' : 'outline'}
              onClick={() => setDealType(dealType === dt ? null : dt)}
            >
              {dt}
            </Button>
          ))}
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) =>
            setSortBy(e.target.value as 'newest' | 'price_asc' | 'price_desc' | 'popular')
          }
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="newest">Newest</option>
          <option value="popular">Most popular</option>
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
        </select>
      </div>

      {/* Modality sub-filter (likeness only) */}
      {kind === 'likeness' && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className="text-xs text-muted-foreground mr-1 self-center">Modality:</span>
          {LIKENESS_MODALITIES.map((m) => (
            <button
              key={m}
              onClick={() => setModality(modality === m ? null : m)}
              className={`px-2 py-1 rounded-full text-xs border ${
                modality === m
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-muted'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading listings…</p>
      ) : listings.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ShieldCheck className="size-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No listings match these filters yet. Be the first — clone your voice in the{' '}
              <Link to="/lab/voice-studio" className="underline">
                Voice Studio
              </Link>{' '}
              and list it for sale.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {listings.map((l) => {
            const linkProps =
              l.entityKind === 'persona'
                ? ({
                    to: '/marketplace/persona/$personaId' as const,
                    params: { personaId: l.entityId },
                  } as const)
                : ({
                    to: '/marketplace/likeness/$listingId' as const,
                    params: { listingId: l.id },
                  } as const);
            return (
              <Link key={l.id} {...linkProps} className="group">
                <Card className="overflow-hidden transition-shadow hover:shadow-md h-full">
                  <div className="relative aspect-square bg-muted">
                    {l.thumbnailUrl ? (
                      <img
                        src={l.thumbnailUrl}
                        alt={l.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {l.entityKind === 'voice' ? (
                          <Mic className="size-12 text-muted-foreground/40" />
                        ) : l.entityKind === 'persona' ? (
                          <UserCircle2 className="size-12 text-muted-foreground/40" />
                        ) : (
                          <Sparkles className="size-12 text-muted-foreground/40" />
                        )}
                      </div>
                    )}
                    <Badge
                      variant="secondary"
                      className="absolute top-2 left-2 text-[10px] capitalize"
                    >
                      {l.entityKind === 'voice' ? (
                        <>
                          <Mic className="size-2.5 mr-1" />
                          Voice
                        </>
                      ) : l.entityKind === 'persona' ? (
                        <>
                          <UserCircle2 className="size-2.5 mr-1" />
                          Persona
                        </>
                      ) : (
                        <>
                          <Sparkles className="size-2.5 mr-1" />
                          Likeness
                        </>
                      )}
                    </Badge>
                  </div>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start gap-1.5">
                      <h3 className="font-semibold text-sm leading-tight truncate flex-1">
                        {l.title}
                      </h3>
                      <BadgeCheck className="size-3.5 text-primary shrink-0 mt-0.5" />
                    </div>
                    {l.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{l.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 pt-1">
                      {l.buyPriceWei !== '0' && (
                        <Badge variant="outline" className="text-[10px]">
                          Buy {formatEthDisplay(l.buyPriceWei)}
                        </Badge>
                      )}
                      {l.leasePricePerDayWei !== '0' && (
                        <Badge variant="outline" className="text-[10px]">
                          Lease {formatEthDisplay(l.leasePricePerDayWei)}/d
                        </Badge>
                      )}
                      {l.licenseFeeWei !== '0' && (
                        <Badge variant="outline" className="text-[10px]">
                          License {formatEthDisplay(l.licenseFeeWei)}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

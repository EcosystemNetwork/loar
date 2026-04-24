/**
 * Characters gallery — dedicated per-universe page showing all minted character
 * NFTs. Distinct from /wiki (general encyclopedia) in that it surfaces NFT
 * economics: accumulated royalties, appearance count, and direct links to the
 * mint-on-mint CharacterNFT contract flow.
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { formatEther } from 'viem';
import { ArrowLeft, Users, TrendingUp, Crown, Clock, Search, Wand2 } from 'lucide-react';
import { useCharacterNFTs } from '@/hooks/useRevenue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import { UserText } from '@/components/user-text';

export const Route = createFileRoute('/characters/$universeId')({
  component: CharactersGalleryPage,
});

type SortKey = 'top' | 'newest' | 'royalties';

function CharactersGalleryPage() {
  const { universeId } = useParams({ from: '/characters/$universeId' });
  const { data: characters, isLoading } = useCharacterNFTs(universeId);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('top');

  const rows = (characters as any[] | undefined) ?? [];
  const filtered = rows
    .filter(
      (c) =>
        !search ||
        String(c.name || '')
          .toLowerCase()
          .includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sort === 'newest') {
        const aAt = new Date(a.createdAt?.toDate?.() ?? a.createdAt ?? 0).getTime();
        const bAt = new Date(b.createdAt?.toDate?.() ?? b.createdAt ?? 0).getTime();
        return bAt - aAt;
      }
      if (sort === 'royalties') {
        return (
          Number(BigInt(b.accumulatedRoyalties ?? '0') - BigInt(a.accumulatedRoyalties ?? '0')) || 0
        );
      }
      return (b.appearanceCount ?? 0) - (a.appearanceCount ?? 0);
    });

  const totalAppearances = rows.reduce((acc, c) => acc + (c.appearanceCount ?? 0), 0);
  const totalRoyalties = rows.reduce((acc, c) => acc + BigInt(c.accumulatedRoyalties ?? '0'), 0n);

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b px-4 py-3 flex items-center gap-3">
        <Link to="/universe/$id/watch" params={{ id: universeId }}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <Users className="w-4 h-4 text-primary" />
        <span className="font-semibold">Character NFTs</span>
      </div>

      <div className="max-w-6xl mx-auto px-4 pt-6">
        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <StatCard
            icon={<Users className="w-4 h-4 text-primary" />}
            label="Characters"
            value={rows.length.toString()}
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4 text-primary" />}
            label="Total appearances"
            value={totalAppearances.toString()}
          />
          <StatCard
            icon={<Crown className="w-4 h-4 text-primary" />}
            label="Royalties accumulated"
            value={`${formatEther(totalRoyalties)} ETH`}
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search characters..."
              className="pl-10 h-9"
            />
          </div>
          <div className="flex gap-1">
            {(['top', 'newest', 'royalties'] as const).map((s) => (
              <Button
                key={s}
                variant={sort === s ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSort(s)}
              >
                {s === 'top' ? 'Top' : s === 'newest' ? 'Newest' : 'Royalties'}
              </Button>
            ))}
          </div>
          <Link to="/create/$kind" params={{ kind: 'person' }}>
            <Button size="sm" variant="outline" className="gap-1">
              <Wand2 className="w-3.5 h-3.5" />
              Mint character
            </Button>
          </Link>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] bg-muted/40 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {rows.length === 0
                ? 'No characters minted in this universe yet.'
                : 'No characters match your search.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((c) => (
              <CharacterCard key={c.id} character={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
          {icon}
          {label}
        </div>
        <p className="text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function CharacterCard({ character }: { character: any }) {
  const royalties = BigInt(character.accumulatedRoyalties ?? '0');
  const createdDate = character.createdAt?.toDate?.() ?? character.createdAt;

  return (
    <Link to="/wiki/character/$id" params={{ id: character.id }}>
      <Card className="overflow-hidden group cursor-pointer hover:shadow-lg transition-all duration-300">
        <div className="aspect-[3/4] bg-muted relative">
          {character.imageUrl ? (
            <img
              src={resolveIpfsUrl(character.imageUrl)}
              alt={character.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Users className="h-10 w-10 text-muted-foreground/40" />
            </div>
          )}
          {character.appearanceCount > 0 && (
            <Badge
              variant="secondary"
              className="absolute top-2 left-2 gap-1 bg-black/60 text-white border-0"
            >
              <TrendingUp className="h-3 w-3" />
              {character.appearanceCount}
            </Badge>
          )}
          {royalties > 0n && (
            <Badge
              variant="secondary"
              className="absolute top-2 right-2 gap-1 bg-primary/80 text-primary-foreground border-0"
            >
              <Crown className="h-3 w-3" />
              {Number(formatEther(royalties)).toFixed(3)}Ξ
            </Badge>
          )}
        </div>
        <CardContent className="p-3 space-y-1">
          <p className="font-medium text-sm truncate">{character.name}</p>
          {character.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 break-words">
              <UserText>{character.description}</UserText>
            </p>
          )}
          {createdDate && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
              <Clock className="h-2.5 w-2.5" />
              {new Date(createdDate).toLocaleDateString()}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

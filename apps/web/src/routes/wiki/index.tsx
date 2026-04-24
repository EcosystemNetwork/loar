/**
 * World Encyclopedia — the wiki hub.
 *
 * Tabbed interface covering all entity kinds (creator + structural) plus a
 * suite of synthesised views: episodes, audio, relationship graph, event
 * timeline, places map, A-Z index, activity feed, stats, creators,
 * bookmarks, gallery, 3D models and the legacy character collection.
 *
 * Universe scoping is preserved via the ?universe= search param.
 */
import { createFileRoute, Link, useSearch, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Search,
  Plus,
  Users,
  MapPin,
  Package,
  Swords,
  Zap,
  BookOpen,
  Dna,
  Layers,
  Cpu,
  Building2,
  GitBranch,
  Eye,
  Box,
  Hexagon,
  Castle,
  Crown,
  ImageIcon,
  Globe,
  Lock,
  UserCircle,
  Rotate3d,
  Filter,
  X,
  Film,
  Music,
  Network,
  CalendarDays,
  Map as MapIcon,
  ListOrdered,
  Activity,
  BarChart3,
  Heart,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserText } from '@/components/user-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ModelViewer } from '@/components/ModelViewer';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

// New wiki components
import { EntityCard } from '@/components/wiki/EntityCard';
import { GalleryGrid } from '@/components/gallery/GalleryGrid';
import { GalleryFilters } from '@/components/gallery/GalleryFilters';
import { useGalleryTrending } from '@/hooks/useGallery';
import { TrendingUp } from 'lucide-react';
import { SortMenu } from '@/components/wiki/SortMenu';
import { sortEntities } from '@/components/wiki/sort';
import { RandomEntityButton } from '@/components/wiki/RandomEntityButton';
import { EpisodesTab } from '@/components/wiki/EpisodesTab';
import { AudioTab } from '@/components/wiki/AudioTab';
import { RelationshipGraphTab } from '@/components/wiki/RelationshipGraphTab';
import { EventTimelineTab } from '@/components/wiki/EventTimelineTab';
import { PlacesMapTab } from '@/components/wiki/PlacesMapTab';
import { AZIndexTab } from '@/components/wiki/AZIndexTab';
import { ActivityTab } from '@/components/wiki/ActivityTab';
import { StatsTab } from '@/components/wiki/StatsTab';
import { CreatorsTab } from '@/components/wiki/CreatorsTab';
import { BookmarksTab } from '@/components/wiki/BookmarksTab';
import type { EntityKind, WikiEntity, WikiTab, WikiSort } from '@/components/wiki/types';

const TABS: {
  id: WikiTab;
  label: string;
  kind?: EntityKind;
  icon: React.ComponentType<{ className?: string }>;
  section: 'creator' | 'structural' | 'narrative' | 'discovery' | 'media' | 'personal';
}[] = [
  // Creator kinds
  { id: 'person', label: 'People', kind: 'person', icon: Users, section: 'creator' },
  { id: 'place', label: 'Places', kind: 'place', icon: MapPin, section: 'creator' },
  { id: 'thing', label: 'Things', kind: 'thing', icon: Package, section: 'creator' },
  { id: 'faction', label: 'Factions', kind: 'faction', icon: Swords, section: 'creator' },
  { id: 'event', label: 'Events', kind: 'event', icon: Zap, section: 'creator' },
  { id: 'lore', label: 'Lore', kind: 'lore', icon: BookOpen, section: 'creator' },
  { id: 'species', label: 'Species', kind: 'species', icon: Dna, section: 'creator' },
  { id: 'vehicle', label: 'Vehicles', kind: 'vehicle', icon: Layers, section: 'creator' },
  { id: 'technology', label: 'Tech', kind: 'technology', icon: Cpu, section: 'creator' },
  { id: 'organization', label: 'Orgs', kind: 'organization', icon: Building2, section: 'creator' },
  // Structural kinds
  { id: 'timeline', label: 'Timelines', kind: 'timeline', icon: GitBranch, section: 'structural' },
  { id: 'reality', label: 'Realities', kind: 'reality', icon: Eye, section: 'structural' },
  { id: 'dimension', label: 'Dimensions', kind: 'dimension', icon: Box, section: 'structural' },
  { id: 'plane', label: 'Planes', kind: 'plane', icon: Hexagon, section: 'structural' },
  { id: 'realm', label: 'Realms', kind: 'realm', icon: Castle, section: 'structural' },
  { id: 'domain', label: 'Domains', kind: 'domain', icon: Crown, section: 'structural' },
  // Narrative content
  { id: 'episodes', label: 'Episodes', icon: Film, section: 'narrative' },
  { id: 'audio', label: 'Audio', icon: Music, section: 'narrative' },
  // Discovery / wiki-native views
  { id: 'graph', label: 'Graph', icon: Network, section: 'discovery' },
  { id: 'event-timeline', label: 'Timeline', icon: CalendarDays, section: 'discovery' },
  { id: 'places-map', label: 'Map', icon: MapIcon, section: 'discovery' },
  { id: 'az-index', label: 'A–Z', icon: ListOrdered, section: 'discovery' },
  { id: 'activity', label: 'Activity', icon: Activity, section: 'discovery' },
  { id: 'stats', label: 'Stats', icon: BarChart3, section: 'discovery' },
  { id: 'creators', label: 'Creators', icon: UserCircle, section: 'discovery' },
  // Media tabs
  { id: 'character-profiles', label: 'Profiles', icon: UserCircle, section: 'media' },
  { id: '3d-models', label: '3D Models', icon: Rotate3d, section: 'media' },
  { id: 'gallery', label: 'Gallery', icon: ImageIcon, section: 'media' },
  { id: 'collection', label: 'Collection', icon: Users, section: 'media' },
  // Personal
  { id: 'bookmarks', label: 'Bookmarks', icon: Heart, section: 'personal' },
];

interface Character {
  id: string;
  character_name: string;
  collection: string;
  token_id: string;
  traits: Record<string, string>;
  rarity_rank: number;
  rarity_percentage?: number;
  image_url: string;
  description: string;
  created_at: string;
}

function EntityTab({ kind, universeAddress }: { kind: EntityKind; universeAddress?: string }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<WikiSort>('newest');

  const { data, isLoading, error } = useQuery({
    queryKey: universeAddress
      ? ['entities', 'list', universeAddress, kind]
      : ['entities', 'listByKind', kind],
    queryFn: () =>
      universeAddress
        ? trpcClient.entities.list.query({ universeAddress, kind })
        : trpcClient.entities.listByKind.query({ kind }),
  });

  const entities = (data?.entities ?? []) as WikiEntity[];
  const filtered = search.trim()
    ? entities.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    : entities;
  const sorted = useMemo(() => sortEntities(filtered, sort), [filtered, sort]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-9"
          />
        </div>
        <SortMenu value={sort} onChange={setSort} />
        <Link
          to="/create/$kind"
          params={{ kind }}
          search={universeAddress ? { universe: universeAddress } : undefined}
        >
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
        </Link>
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading...</div>}
      {error && <div className="text-center py-12 text-red-500 text-sm">{error.message}</div>}

      {!isLoading && !error && sorted.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="mb-4">Nothing here yet.</p>
          <Link
            to="/create/$kind"
            params={{ kind }}
            search={universeAddress ? { universe: universeAddress } : undefined}
          >
            <Button variant="outline">Create the first one</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sorted.map((entity) => (
          <EntityCard key={entity.id} entity={entity} />
        ))}
      </div>
    </div>
  );
}

type GalleryMediaType = 'all' | 'video' | 'image' | 'audio' | '3d';
type GalleryOrigin = 'all' | 'generated' | 'uploaded';
type GallerySort = 'newest' | 'trending' | 'price_asc' | 'price_desc';

function GalleryTab({ universeAddress }: { universeAddress?: string }) {
  const [search, setSearch] = useState('');
  const [mediaType, setMediaType] = useState<GalleryMediaType>('all');
  const [sortBy, setSortBy] = useState<GallerySort>('newest');
  const [originFilter, setOriginFilter] = useState<GalleryOrigin>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['wiki', 'gallery', universeAddress, mediaType, sortBy, originFilter],
    queryFn: () =>
      trpcClient.gallery.browse.query({
        universeId: universeAddress,
        mediaType,
        origin: originFilter,
        sortBy,
        limit: 40,
      }),
  });

  const { data: trending } = useGalleryTrending(universeAddress, 8);

  const items = data?.items ?? [];
  const filtered = search.trim()
    ? items.filter(
        (item: any) =>
          item.title?.toLowerCase().includes(search.toLowerCase()) ||
          item.description?.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  return (
    <div className="space-y-6">
      {/* Trending row — hidden while searching to keep the page calm */}
      {trending && trending.length > 0 && !search.trim() && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              Trending
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {trending.slice(0, 4).map((item: any) => {
                const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';
                const isAudio = item.mediaType === 'audio';
                const is3D = item.mediaType === '3d' || item.mediaType === 'ai-3d';
                // 3D/audio mediaUrl is a .glb/.mp3 — never use as an <img> source.
                const visualThumbnail =
                  isAudio || is3D
                    ? item.thumbnailUrl || item.imageUrl || null
                    : item.thumbnailUrl || item.imageUrl || item.mediaUrl || '/placeholder.jpg';
                return (
                  <div
                    key={item.id}
                    className="relative aspect-video rounded-lg overflow-hidden group cursor-pointer"
                  >
                    {isVideo && item.mediaUrl ? (
                      <video
                        src={`${resolveIpfsUrl(item.mediaUrl)}#t=0.5`}
                        className="w-full h-full object-cover"
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        poster={resolveIpfsUrl(item.thumbnailUrl || item.imageUrl) || undefined}
                        onMouseEnter={(e) => {
                          const p = e.currentTarget.play();
                          if (p) p.catch(() => {});
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                      />
                    ) : visualThumbnail ? (
                      <img
                        src={resolveIpfsUrl(visualThumbnail) || visualThumbnail}
                        alt={item.title || 'Trending'}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = '/placeholder.jpg';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-500/20 to-rose-500/20">
                        {is3D ? (
                          <Box className="h-8 w-8 text-foreground/60" />
                        ) : (
                          <Music className="h-8 w-8 text-foreground/60" />
                        )}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <div className="absolute bottom-2 left-2 text-white text-xs font-medium truncate max-w-[90%]">
                      {item.title || 'Untitled'}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shared filter bar: search + media pills + sort + origin */}
      <GalleryFilters
        mediaType={mediaType}
        onMediaTypeChange={(v) => setMediaType(v as GalleryMediaType)}
        sortBy={sortBy}
        onSortByChange={(v) => setSortBy(v as GallerySort)}
        searchQuery={search}
        onSearchChange={setSearch}
        originFilter={originFilter}
        onOriginFilterChange={(v) => setOriginFilter(v as GalleryOrigin)}
      />

      <div className="flex justify-end">
        <Link to="/sandbox">
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            Create in Sandbox
          </Button>
        </Link>
      </div>

      <GalleryGrid
        items={filtered}
        isLoading={isLoading}
        emptyMessage={galleryEmptyMessage(mediaType, originFilter)}
      />
    </div>
  );
}

/**
 * MediaType-aware empty state. Generic "no content" is misleading when a
 * filter is on — users think the gallery is empty when really the filtered
 * kind just hasn't been generated yet.
 */
function galleryEmptyMessage(mediaType: GalleryMediaType, origin: GalleryOrigin): string {
  if (origin === 'uploaded') return 'No uploaded content matches this filter yet.';
  if (origin === 'generated' && mediaType === 'all') {
    return 'No AI-generated content yet. Try the studio.';
  }
  switch (mediaType) {
    case '3d':
      return 'No 3D models yet — generate one from the studio.';
    case 'audio':
      return 'No audio yet — try voice synthesis or music generation.';
    case 'video':
      return 'No videos yet — try image-to-video in the studio.';
    case 'image':
      return 'No images yet — try text-to-image in the studio.';
    default:
      return 'No content yet. Be the first to create something!';
  }
}

function CollectionTab() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['wiki', 'characters'],
    queryFn: () => trpcClient.wiki.characters.query(),
  });

  const characters: Character[] = data?.characters ?? [];
  const filtered = search.trim()
    ? characters.filter(
        (c) =>
          c.character_name.toLowerCase().includes(search.toLowerCase()) ||
          c.collection.toLowerCase().includes(search.toLowerCase())
      )
    : characters;

  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search characters..."
          className="pl-9"
        />
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">No characters found.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((char) => (
          <Link key={char.id} to="/wiki/character/$id" params={{ id: char.id }} className="block">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
              <div className="aspect-square w-full overflow-hidden rounded-t-lg relative bg-muted">
                <div className="absolute inset-0 flex items-center justify-center">
                  <Users className="h-10 w-10 text-muted-foreground/30" />
                </div>
                {char.image_url && (
                  <img
                    src={resolveIpfsUrl(char.image_url)}
                    alt={char.character_name}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </div>
              <CardContent className="p-3">
                <p className="font-semibold">{char.character_name}</p>
                <p className="text-xs text-muted-foreground">
                  {char.collection} #{char.token_id}
                </p>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1 break-words">
                  <UserText>{char.description}</UserText>
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {Object.entries(char.traits)
                    .slice(0, 3)
                    .map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="text-xs">
                        {v}
                      </Badge>
                    ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CharacterProfilesTab({ universeAddress }: { universeAddress?: string }) {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: universeAddress
      ? ['entities', 'list', universeAddress, 'person']
      : ['entities', 'listByKind', 'person'],
    queryFn: () =>
      universeAddress
        ? trpcClient.entities.list.query({ universeAddress, kind: 'person' })
        : trpcClient.entities.listByKind.query({ kind: 'person' }),
  });

  const entities = ((data?.entities ?? []) as WikiEntity[]).filter(
    (e) => e.description || e.imageUrl || Object.keys(e.metadata ?? {}).length > 0
  );
  const filtered = search.trim()
    ? entities.filter(
        (e) =>
          e.name.toLowerCase().includes(search.toLowerCase()) ||
          e.description?.toLowerCase().includes(search.toLowerCase())
      )
    : entities;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search character profiles..."
            className="pl-9"
          />
        </div>
        <Link
          to="/create/$kind"
          params={{ kind: 'person' }}
          search={universeAddress ? { universe: universeAddress } : undefined}
        >
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            New Character
          </Button>
        </Link>
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <UserCircle className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="mb-2">No character profiles yet.</p>
          <p className="text-xs mb-4">
            Create a person entity and generate a bio to build a full character profile.
          </p>
          <Link
            to="/create/$kind"
            params={{ kind: 'person' }}
            search={universeAddress ? { universe: universeAddress } : undefined}
          >
            <Button variant="outline">Create Character</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((entity) => (
          <Link key={entity.id} to="/wiki/entity/$id" params={{ id: entity.id }} className="block">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
              <div className="flex gap-4 p-4">
                <div className="w-20 h-20 rounded-full overflow-hidden bg-muted flex-shrink-0 relative">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <UserCircle className="h-10 w-10 text-muted-foreground/30" />
                  </div>
                  {entity.imageUrl && (
                    <img
                      src={resolveIpfsUrl(entity.imageUrl)}
                      alt={entity.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base truncate">{entity.name}</h3>
                  {(entity.metadata as Record<string, unknown>)?.role ? (
                    <p className="text-xs text-primary mt-0.5">
                      {String((entity.metadata as Record<string, unknown>).role)}
                    </p>
                  ) : null}
                  {entity.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1 break-words">
                      <UserText>{entity.description}</UserText>
                    </p>
                  )}
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {Object.entries(entity.metadata ?? {})
                      .filter(([k]) => ['abilities', 'affiliations', 'homePlace'].includes(k))
                      .slice(0, 2)
                      .map(([k, v]) => (
                        <Badge key={k} variant="secondary" className="text-[10px]">
                          {String(v).slice(0, 20)}
                        </Badge>
                      ))}
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ThreeDModelsTab({ universeAddress }: { universeAddress?: string }) {
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const { data: galleryData, isLoading: galleryLoading } = useQuery({
    queryKey: ['wiki', '3d-gallery', universeAddress],
    queryFn: () =>
      trpcClient.gallery.browse.query({
        universeId: universeAddress,
        mediaType: '3d',
        sortBy: 'newest',
        limit: 50,
      }),
  });

  const galleryItems = galleryData?.items ?? [];
  // Hide legacy untextured intermediates — the pipeline now publishes only
  // the final textured model, but old records remain in the collection.
  const texturedOnly = galleryItems.filter(
    (item: any) => !(Array.isArray(item.tags) && item.tags.includes('untextured'))
  );
  const filteredGallery = search.trim()
    ? texturedOnly.filter(
        (item: any) =>
          item.title?.toLowerCase().includes(search.toLowerCase()) ||
          item.description?.toLowerCase().includes(search.toLowerCase())
      )
    : texturedOnly;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search 3D models..."
            className="pl-9"
          />
        </div>
      </div>

      {galleryLoading && <div className="text-center py-12 text-muted-foreground">Loading...</div>}

      {!galleryLoading && filteredGallery.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Rotate3d className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="mb-2">No 3D models yet.</p>
          <p className="text-xs mb-4">
            Create a character entity and use "Generate 3D Character" to produce 2D art, 3D models,
            and textured assets.
          </p>
          <Link to="/create/$kind" params={{ kind: 'person' }}>
            <Button variant="outline">Create a Character</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredGallery.map((item: any) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelectedItem(item)}
            className="text-left w-full"
          >
            <Card className="overflow-hidden hover:shadow-lg hover:ring-2 hover:ring-primary/40 transition-all cursor-pointer">
              <div className="aspect-square bg-muted relative">
                <div className="absolute inset-0 flex items-center justify-center">
                  <Rotate3d className="h-6 w-6 text-muted-foreground/30" />
                </div>
                {(item.thumbnailUrl || item.mediaUrl) && (
                  <img
                    src={resolveIpfsUrl(item.thumbnailUrl || item.mediaUrl)}
                    alt={item.title}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                <Badge className="absolute top-2 left-2 bg-black/60 text-white border-0 text-[10px]">
                  <Rotate3d className="h-2.5 w-2.5 mr-1" />
                  3D
                </Badge>
              </div>
              <CardContent className="p-3">
                <p className="text-sm font-medium truncate">{item.title}</p>
                {item.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5 break-words">
                    <UserText>{item.description}</UserText>
                  </p>
                )}
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedItem?.title ?? '3D Model'}</DialogTitle>
            {selectedItem?.description && (
              <DialogDescription>{selectedItem.description}</DialogDescription>
            )}
          </DialogHeader>
          {selectedItem?.mediaUrl ? (
            <div className="h-[60vh] w-full">
              <ModelViewer
                src={resolveIpfsUrl(selectedItem.mediaUrl)}
                poster={resolveIpfsUrl(selectedItem.thumbnailUrl) || undefined}
                alt={selectedItem.title || '3D Model'}
                className="h-full"
              />
            </div>
          ) : (
            <div className="h-[40vh] flex items-center justify-center text-muted-foreground text-sm">
              No 3D asset URL available for this item.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GlobalSearchResults({
  query,
  universeAddress,
}: {
  query: string;
  universeAddress?: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['entity-search', query, universeAddress],
    queryFn: () =>
      trpcClient.entities.search.query({
        query,
        universeAddress,
        limit: 30,
      }),
    enabled: query.length >= 2,
  });

  if (query.length < 2) return null;
  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Searching...</div>;

  const entities = (data?.entities ?? []) as WikiEntity[];
  if (entities.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No results for "{query}"</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {entities.length} result{entities.length !== 1 ? 's' : ''} for "{query}"
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {entities.map((entity) => (
          <EntityCard key={entity.id} entity={entity} />
        ))}
      </div>
    </div>
  );
}

function WikiPage() {
  const { universe: universeAddress, tab: urlTab } = useSearch({ from: '/wiki/' });
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<WikiTab>((urlTab as WikiTab) ?? 'gallery');
  const [globalSearch, setGlobalSearch] = useState('');

  // Keep component state in sync with the URL when the user navigates back/forward
  // or when another surface (e.g. the /gallery redirect) changes ?tab=.
  // Missing ?tab= means the default tab ('gallery') — the wiki's discovery surface.
  const expectedTab = ((urlTab as WikiTab) ?? 'gallery') as WikiTab;
  if (expectedTab !== activeTab) {
    setActiveTab(expectedTab);
  }

  // Build a /wiki search object. 'gallery' is the default, so it's omitted from
  // the URL to keep the no-tab case clean.
  const buildSearch = (tab: WikiTab, universe: string | undefined) => {
    const s: { universe?: string; tab?: string } = {};
    if (universe) s.universe = universe;
    if (tab !== 'gallery') s.tab = tab;
    return s;
  };

  const selectTab = (tab: WikiTab) => {
    setActiveTab(tab);
    navigate({ to: '/wiki', search: buildSearch(tab, universeAddress) });
  };

  const { data: universeResult } = useQuery({
    queryKey: ['universe', universeAddress],
    queryFn: () => trpcClient.universes.get.query({ id: universeAddress! }),
    enabled: !!universeAddress,
  });
  const universeInfo = universeResult?.data as
    | { id: string; name?: string; image_url?: string; accessModel?: string }
    | undefined;

  const { data: allUniverses } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.universes.getAll.query(),
  });
  const universes = ((allUniverses as any)?.data ?? allUniverses ?? []) as any[];

  const publicUniverses = Array.isArray(universes)
    ? universes.filter((u: any) => u.accessModel !== 'private' && u.accessModel !== 'token_gate')
    : [];

  const sectionedTabs = useMemo(() => {
    const sections: Array<{ section: string; tabs: typeof TABS }> = [
      { section: 'creator', tabs: TABS.filter((t) => t.section === 'creator') },
      { section: 'structural', tabs: TABS.filter((t) => t.section === 'structural') },
      { section: 'narrative', tabs: TABS.filter((t) => t.section === 'narrative') },
      { section: 'discovery', tabs: TABS.filter((t) => t.section === 'discovery') },
      { section: 'media', tabs: TABS.filter((t) => t.section === 'media') },
      { section: 'personal', tabs: TABS.filter((t) => t.section === 'personal') },
    ];
    return sections;
  }, []);

  const activeTabDef = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">World Encyclopedia</h1>
          <p className="text-muted-foreground mt-1">
            {universeInfo
              ? `Everything in ${universeInfo.name ?? 'this universe'}.`
              : 'Everything known across all public universes.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search all entities..."
              className="pl-9 h-9 text-xs"
            />
          </div>
          <RandomEntityButton universeAddress={universeAddress} />
          <Link to="/create" search={universeAddress ? { universe: universeAddress } : undefined}>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Create
            </Button>
          </Link>
        </div>
      </div>

      {/* Universe filter bar */}
      <div className="mb-6 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center gap-2 mb-2.5">
          <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium">Filter by Universe</span>
          {universeAddress && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => navigate({ to: '/wiki', search: buildSearch(activeTab, undefined) })}
            >
              <X className="h-3 w-3 mr-1" />
              Clear filter
            </Button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => navigate({ to: '/wiki', search: buildSearch(activeTab, undefined) })}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
              !universeAddress
                ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/20'
                : 'border-border bg-background hover:bg-muted hover:border-foreground/20 text-muted-foreground hover:text-foreground'
            }`}
          >
            <Globe className="h-4 w-4" />
            All Universes
          </button>
          {publicUniverses.map((u: any) => (
            <button
              key={u.id}
              onClick={() => navigate({ to: '/wiki', search: buildSearch(activeTab, u.id) })}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                universeAddress === u.id
                  ? 'border-violet-500 bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20'
                  : 'border-border bg-background hover:bg-muted hover:border-foreground/20 text-muted-foreground hover:text-foreground'
              }`}
            >
              {u.image_url ? (
                <img
                  src={resolveIpfsUrl(u.image_url)}
                  alt=""
                  className="h-5 w-5 rounded object-cover flex-shrink-0"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className="h-5 w-5 rounded bg-gradient-to-br from-violet-500/30 to-purple-500/30 flex items-center justify-center flex-shrink-0">
                  <Globe className="h-3 w-3" />
                </div>
              )}
              {u.name || u.id.slice(0, 10) + '...'}
            </button>
          ))}
          {publicUniverses.length === 0 && (
            <p className="text-xs text-muted-foreground py-1.5 px-2">No universes found.</p>
          )}
        </div>
      </div>

      {/* Universe banner when scoped */}
      {universeInfo && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-purple-500/10 p-4">
          {universeInfo.image_url && (
            <img
              src={resolveIpfsUrl(universeInfo.image_url)}
              alt=""
              className="h-12 w-12 rounded-lg object-cover flex-shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Viewing wiki for
            </p>
            <p className="text-lg font-bold truncate">{universeInfo.name}</p>
          </div>
          {universeInfo.accessModel && universeInfo.accessModel !== 'open' && (
            <Badge variant="outline" className="text-xs gap-1">
              <Lock className="h-3 w-3" />
              {universeInfo.accessModel}
            </Badge>
          )}
        </div>
      )}

      {/* Tab bar — sectioned */}
      <div className="flex gap-0.5 overflow-x-auto pb-1 mb-6 border-b">
        {sectionedTabs.map((sec, idx) => (
          <div key={sec.section} className="flex items-center gap-0.5">
            {idx > 0 && <div className="w-px bg-border mx-1 self-stretch my-1" />}
            {sec.tabs.map((tab) => (
              <TabButton
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTab}
                onClick={() => selectTab(tab.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Tab content — global search overrides tab view */}
      {globalSearch.trim().length >= 2 ? (
        <GlobalSearchResults query={globalSearch.trim()} universeAddress={universeAddress} />
      ) : activeTabDef.kind ? (
        <EntityTab kind={activeTabDef.kind} universeAddress={universeAddress} />
      ) : activeTab === 'character-profiles' ? (
        <CharacterProfilesTab universeAddress={universeAddress} />
      ) : activeTab === '3d-models' ? (
        <ThreeDModelsTab universeAddress={universeAddress} />
      ) : activeTab === 'gallery' ? (
        <GalleryTab universeAddress={universeAddress} />
      ) : activeTab === 'collection' ? (
        <CollectionTab />
      ) : activeTab === 'episodes' ? (
        <EpisodesTab universeAddress={universeAddress} />
      ) : activeTab === 'audio' ? (
        <AudioTab universeAddress={universeAddress} />
      ) : activeTab === 'graph' ? (
        <RelationshipGraphTab universeAddress={universeAddress} />
      ) : activeTab === 'event-timeline' ? (
        <EventTimelineTab universeAddress={universeAddress} />
      ) : activeTab === 'places-map' ? (
        <PlacesMapTab universeAddress={universeAddress} />
      ) : activeTab === 'az-index' ? (
        <AZIndexTab universeAddress={universeAddress} />
      ) : activeTab === 'activity' ? (
        <ActivityTab />
      ) : activeTab === 'stats' ? (
        <StatsTab universeAddress={universeAddress} />
      ) : activeTab === 'creators' ? (
        <CreatorsTab />
      ) : activeTab === 'bookmarks' ? (
        <BookmarksTab />
      ) : null}
    </div>
  );
}

function TabButton({
  tab,
  isActive,
  onClick,
}: {
  tab: (typeof TABS)[number];
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md whitespace-nowrap transition-colors border-b-2 -mb-px ${
        isActive
          ? 'border-primary text-primary bg-primary/5'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {tab.label}
    </button>
  );
}

const wikiSearchSchema = z.object({
  universe: z.string().optional(),
  tab: z.string().optional(),
});

export const Route = createFileRoute('/wiki/')({
  component: WikiPage,
  validateSearch: wikiSearchSchema,
});

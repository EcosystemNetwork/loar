/**
 * World Encyclopedia — the wiki hub.
 *
 * Tabbed interface covering all entity kinds (creator + structural).
 * Each tab shows the entities for that kind, loaded from the top-level
 * entities collection. Supports optional universe scoping via search param.
 *
 * The "Gallery" tab shows promoted content (from sandbox or direct uploads).
 * The "Collection" tab retains the legacy character NFT gallery.
 */
import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Video,
  Globe,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type EntityKind =
  | 'person'
  | 'place'
  | 'thing'
  | 'faction'
  | 'event'
  | 'lore'
  | 'species'
  | 'vehicle'
  | 'technology'
  | 'organization'
  | 'timeline'
  | 'reality'
  | 'dimension'
  | 'plane'
  | 'realm'
  | 'domain';

type WikiTab = EntityKind | 'gallery' | 'collection';

const TABS: {
  id: WikiTab;
  label: string;
  kind?: EntityKind;
  icon: React.ComponentType<{ className?: string }>;
  section?: 'creator' | 'structural' | 'other';
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
  {
    id: 'organization',
    label: 'Orgs',
    kind: 'organization',
    icon: Building2,
    section: 'creator',
  },
  // Structural kinds
  { id: 'timeline', label: 'Timelines', kind: 'timeline', icon: GitBranch, section: 'structural' },
  { id: 'reality', label: 'Realities', kind: 'reality', icon: Eye, section: 'structural' },
  { id: 'dimension', label: 'Dimensions', kind: 'dimension', icon: Box, section: 'structural' },
  { id: 'plane', label: 'Planes', kind: 'plane', icon: Hexagon, section: 'structural' },
  { id: 'realm', label: 'Realms', kind: 'realm', icon: Castle, section: 'structural' },
  { id: 'domain', label: 'Domains', kind: 'domain', icon: Crown, section: 'structural' },
  // Special tabs
  { id: 'gallery', label: 'Gallery', icon: ImageIcon, section: 'other' },
  { id: 'collection', label: 'Collection', icon: Users, section: 'other' },
];

interface Entity {
  id: string;
  name: string;
  description: string;
  kind: string;
  imageUrl: string | null;
  universeAddress: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | Date;
}

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

interface ContentItem {
  id: string;
  title: string;
  description: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  mediaType: string;
  classification: string;
  universeId?: string;
  creatorUid: string;
  createdAt: string | Date;
}

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  person: Users,
  place: MapPin,
  thing: Package,
  faction: Swords,
  event: Zap,
  lore: BookOpen,
  species: Dna,
  vehicle: Layers,
  technology: Cpu,
  organization: Building2,
  timeline: GitBranch,
  reality: Eye,
  dimension: Box,
  plane: Hexagon,
  realm: Castle,
  domain: Crown,
};

function EntityCard({ entity }: { entity: Entity }) {
  const KindIcon = KIND_ICONS[entity.kind] ?? Package;
  return (
    <Link to="/wiki/entity/$id" params={{ id: entity.id }} className="block">
      <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
        <div className="aspect-video w-full overflow-hidden rounded-t-lg">
          {entity.imageUrl ? (
            <img src={entity.imageUrl} alt={entity.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <KindIcon className="h-10 w-10 text-muted-foreground/30" />
            </div>
          )}
        </div>
        <CardHeader className="pb-2">
          <CardTitle className="text-base leading-snug">{entity.name}</CardTitle>
        </CardHeader>
        <CardContent>
          {entity.description && (
            <p className="text-sm text-muted-foreground line-clamp-3">{entity.description}</p>
          )}
          {entity.universeAddress && (
            <Badge variant="outline" className="mt-2 text-xs font-mono truncate max-w-full">
              {entity.universeAddress.slice(0, 10)}...
            </Badge>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function EntityTab({ kind, universeAddress }: { kind: EntityKind; universeAddress?: string }) {
  const [search, setSearch] = useState('');

  // If universe-scoped, use entities.list (filters by universeAddress)
  // Otherwise use entities.listByKind (global)
  const { data, isLoading, error } = useQuery({
    queryKey: universeAddress
      ? ['entities', 'list', universeAddress, kind]
      : ['entities', 'listByKind', kind],
    queryFn: () =>
      universeAddress
        ? trpcClient.entities.list.query({ universeAddress, kind })
        : trpcClient.entities.listByKind.query({ kind }),
  });

  const entities: Entity[] = data?.entities ?? [];
  const filtered = search.trim()
    ? entities.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    : entities;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-9"
          />
        </div>
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

      {!isLoading && !error && filtered.length === 0 && (
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
        {filtered.map((entity) => (
          <EntityCard key={entity.id} entity={entity} />
        ))}
      </div>
    </div>
  );
}

function GalleryTab({ universeAddress }: { universeAddress?: string }) {
  const [search, setSearch] = useState('');
  const [mediaFilter, setMediaFilter] = useState<'all' | 'video' | 'image'>('all');

  // Fetch ALL public content via gallery.browse (supports universe scoping + media type filter)
  const { data, isLoading } = useQuery({
    queryKey: ['wiki', 'gallery', universeAddress, mediaFilter],
    queryFn: () =>
      trpcClient.gallery.browse.query({
        universeId: universeAddress,
        mediaType: mediaFilter,
        sortBy: 'newest',
        limit: 50,
      }),
  });

  const items = data?.items ?? [];
  const filtered = search.trim()
    ? items.filter(
        (item: any) =>
          item.title?.toLowerCase().includes(search.toLowerCase()) ||
          item.description?.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search gallery..."
            className="pl-9"
          />
        </div>
        <Select value={mediaFilter} onValueChange={(v) => setMediaFilter(v as any)}>
          <SelectTrigger className="h-9 text-xs w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              All Media
            </SelectItem>
            <SelectItem value="video" className="text-xs">
              Videos
            </SelectItem>
            <SelectItem value="image" className="text-xs">
              Images
            </SelectItem>
          </SelectContent>
        </Select>
        <Link to="/sandbox">
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            Create in Sandbox
          </Button>
        </Link>
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <ImageIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="mb-4">No gallery content yet.</p>
          <p className="text-xs mb-4">
            Generate images & videos in the Sandbox, then promote them here.
          </p>
          <Link to="/sandbox">
            <Button variant="outline">Open Sandbox</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((item: any) => {
          const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';
          return (
            <Card key={item.id} className="overflow-hidden hover:shadow-lg transition-shadow">
              <div className="aspect-video bg-muted relative">
                {isVideo && item.mediaUrl ? (
                  <video
                    src={item.mediaUrl}
                    poster={item.thumbnailUrl || undefined}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play()}
                    onMouseLeave={(e) => {
                      const v = e.currentTarget as HTMLVideoElement;
                      v.pause();
                      v.currentTime = 0;
                    }}
                  />
                ) : item.mediaUrl || item.thumbnailUrl ? (
                  <img
                    src={item.mediaUrl || item.thumbnailUrl}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
                  </div>
                )}
                {isVideo && (
                  <Badge className="absolute top-2 left-2 bg-black/60 text-white border-0 text-[10px]">
                    <Video className="h-2.5 w-2.5 mr-1" />
                    Video
                  </Badge>
                )}
                {item.classification && (
                  <Badge
                    variant="outline"
                    className="absolute top-2 right-2 bg-black/60 text-white border-0 text-[10px]"
                  >
                    {item.classification}
                  </Badge>
                )}
              </div>
              <CardContent className="p-3">
                <p className="text-sm font-medium truncate">{item.title}</p>
                {item.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {item.description}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
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
              <div className="aspect-square w-full overflow-hidden rounded-t-lg">
                {char.image_url ? (
                  <img
                    src={char.image_url}
                    alt={char.character_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center">
                    <Users className="h-10 w-10 text-muted-foreground/30" />
                  </div>
                )}
              </div>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{char.character_name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {char.collection} #{char.token_id}
                </p>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-2">{char.description}</p>
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

function WikiPage() {
  const { universe: universeAddress } = useSearch({ from: '/wiki/' });
  const [activeTab, setActiveTab] = useState<WikiTab>('person');

  // Fetch universe info if scoped
  const { data: universeResult } = useQuery({
    queryKey: ['universe', universeAddress],
    queryFn: () => trpcClient.universes.get.query({ id: universeAddress! }),
    enabled: !!universeAddress,
  });
  const universeInfo = universeResult?.data as
    | { id: string; name?: string; image_url?: string; accessModel?: string }
    | undefined;

  // Fetch all universes for the filter dropdown
  const { data: allUniverses } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.universes.getAll.query(),
  });
  const universes = ((allUniverses as any)?.data ?? allUniverses ?? []) as any[];

  // Filter out private universes from the global wiki (unless user is viewing their own)
  const publicUniverses = Array.isArray(universes)
    ? universes.filter((u: any) => u.accessModel !== 'private' && u.accessModel !== 'token_gate')
    : [];

  const creatorTabs = TABS.filter((t) => t.section === 'creator');
  const structuralTabs = TABS.filter((t) => t.section === 'structural');
  const otherTabs = TABS.filter((t) => t.section === 'other');

  const activeTabDef = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">World Encyclopedia</h1>
          <p className="text-muted-foreground mt-1">
            {universeInfo
              ? `Everything in ${universeInfo.name ?? 'this universe'}.`
              : 'Everything known across all public universes.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Universe filter */}
          <Select
            value={universeAddress ?? '__all__'}
            onValueChange={(v) => {
              const url = v === '__all__' ? '/wiki' : `/wiki?universe=${v}`;
              window.history.replaceState(null, '', url);
              window.location.reload();
            }}
          >
            <SelectTrigger className="h-9 text-xs w-48">
              <Globe className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />
              <SelectValue placeholder="All Universes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__" className="text-xs">
                All Public Universes
              </SelectItem>
              {publicUniverses.map((u: any) => (
                <SelectItem key={u.id} value={u.id} className="text-xs">
                  {u.name || u.id.slice(0, 12)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Link to="/create" search={universeAddress ? { universe: universeAddress } : undefined}>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Create
            </Button>
          </Link>
        </div>
      </div>

      {/* Universe banner when scoped */}
      {universeInfo && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-purple-500/10 p-4">
          {universeInfo.image_url && (
            <img
              src={universeInfo.image_url}
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

      {/* Tab bar — grouped: creator | structural | other */}
      <div className="flex gap-0.5 overflow-x-auto pb-1 mb-6 border-b">
        {creatorTabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTab}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
        <div className="w-px bg-border mx-1 my-1" />
        {structuralTabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTab}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
        <div className="w-px bg-border mx-1 my-1" />
        {otherTabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTab}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
      </div>

      {/* Tab content */}
      {activeTabDef.kind ? (
        <EntityTab kind={activeTabDef.kind} universeAddress={universeAddress} />
      ) : activeTab === 'gallery' ? (
        <GalleryTab universeAddress={universeAddress} />
      ) : (
        <CollectionTab />
      )}
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
});

export const Route = createFileRoute('/wiki/')({
  component: WikiPage,
  validateSearch: wikiSearchSchema,
});

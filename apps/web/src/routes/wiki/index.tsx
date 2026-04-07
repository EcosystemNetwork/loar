/**
 * World Encyclopedia — the wiki hub.
 *
 * Tabbed interface covering all entity kinds. Each tab shows the entities
 * for that kind, loaded from the top-level entities collection.
 *
 * The "Collection" tab retains the legacy character NFT gallery.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type WikiTab =
  | 'people'
  | 'places'
  | 'things'
  | 'factions'
  | 'events'
  | 'lore'
  | 'species'
  | 'vehicles'
  | 'technology'
  | 'organizations'
  | 'collection';

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
  | 'organization';

const TABS: {
  id: WikiTab;
  label: string;
  kind?: EntityKind;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'people', label: 'People', kind: 'person', icon: Users },
  { id: 'places', label: 'Places', kind: 'place', icon: MapPin },
  { id: 'things', label: 'Things', kind: 'thing', icon: Package },
  { id: 'factions', label: 'Factions', kind: 'faction', icon: Swords },
  { id: 'events', label: 'Events', kind: 'event', icon: Zap },
  { id: 'lore', label: 'Lore', kind: 'lore', icon: BookOpen },
  { id: 'species', label: 'Species', kind: 'species', icon: Dna },
  { id: 'vehicles', label: 'Vehicles', kind: 'vehicle', icon: Layers },
  { id: 'technology', label: 'Tech', kind: 'technology', icon: Cpu },
  { id: 'organizations', label: 'Orgs', kind: 'organization', icon: Building2 },
  { id: 'collection', label: 'Collection', icon: Users },
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

function EntityCard({ entity }: { entity: Entity }) {
  return (
    <Link to="/wiki/entity/$id" params={{ id: entity.id }} className="block">
      <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
        {entity.imageUrl && (
          <div className="aspect-video w-full overflow-hidden rounded-t-lg">
            <img src={entity.imageUrl} alt={entity.name} className="w-full h-full object-cover" />
          </div>
        )}
        <CardHeader className="pb-2">
          <CardTitle className="text-base leading-snug">{entity.name}</CardTitle>
        </CardHeader>
        <CardContent>
          {entity.description && (
            <p className="text-sm text-muted-foreground line-clamp-3">{entity.description}</p>
          )}
          {entity.universeAddress && (
            <Badge variant="outline" className="mt-2 text-xs font-mono truncate max-w-full">
              {entity.universeAddress.slice(0, 10)}…
            </Badge>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function EntityTab({ kind }: { kind: EntityKind }) {
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['entities', 'listByKind', kind],
    queryFn: () => trpcClient.entities.listByKind.query({ kind }),
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
        <Link to="/create/$kind" params={{ kind }}>
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
          <Link to="/create/$kind" params={{ kind }}>
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
                <img
                  src={char.image_url}
                  alt={char.character_name}
                  className="w-full h-full object-cover"
                />
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
  const [activeTab, setActiveTab] = useState<WikiTab>('people');
  const active = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">World Encyclopedia</h1>
          <p className="text-muted-foreground mt-1">Everything known about every universe.</p>
        </div>
        <Link to="/create">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Create
          </Button>
        </Link>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-1 mb-6 border-b">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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
        })}
      </div>

      {/* Tab content */}
      {active.kind ? <EntityTab kind={active.kind} /> : <CollectionTab />}
    </div>
  );
}

export const Route = createFileRoute('/wiki/')({
  component: WikiPage,
});

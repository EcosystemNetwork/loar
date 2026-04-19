/**
 * Wiki page filtered by entity kind.
 *
 * Route: /wiki/$kind
 * Displays a grid of all entities matching the given kind (person, place, etc.)
 * with cards linking through to the entity detail page.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
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
import { resolveIpfsUrl } from '@/utils/ipfs-url';

const VALID_KINDS = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
] as const;

type CreatorKind = (typeof VALID_KINDS)[number];

const KIND_DISPLAY_NAMES: Record<CreatorKind, string> = {
  person: 'People',
  place: 'Places',
  thing: 'Things',
  faction: 'Factions',
  event: 'Events',
  lore: 'Lore',
  species: 'Species',
  vehicle: 'Vehicles',
  technology: 'Technology',
  organization: 'Organizations',
};

const KIND_ICONS: Record<CreatorKind, React.ComponentType<{ className?: string }>> = {
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
};

function isValidKind(kind: string): kind is CreatorKind {
  return (VALID_KINDS as readonly string[]).includes(kind);
}

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

function WikiKindPage() {
  const { kind } = Route.useParams();
  const validKind = isValidKind(kind);

  // Hooks must run unconditionally — query is enabled only when kind is valid
  const { data, isLoading, error } = useQuery({
    queryKey: ['entities', 'listByKind', kind],
    queryFn: () => trpcClient.entities.listByKind.query({ kind: kind as any }),
    enabled: validKind,
  });

  if (!validKind) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Link to="/wiki">
          <Button variant="outline" className="mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Wiki
          </Button>
        </Link>
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold text-zinc-300 mb-2">Unknown Kind</h2>
          <p className="text-muted-foreground">
            "{kind}" is not a valid entity kind. Please choose from the wiki categories.
          </p>
        </div>
      </div>
    );
  }

  const displayName = KIND_DISPLAY_NAMES[kind];

  const entities: Entity[] = data?.entities ?? [];

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Link to="/wiki">
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Wiki
        </Button>
      </Link>

      <h1 className="text-3xl font-bold mb-6">{displayName}</h1>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-full bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <div className="h-5 w-3/4 bg-zinc-800 rounded animate-pulse" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-4 w-full bg-zinc-800 rounded animate-pulse" />
                <div className="h-4 w-5/6 bg-zinc-800 rounded animate-pulse" />
                <div className="h-5 w-16 bg-zinc-800 rounded animate-pulse mt-3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <div className="text-center py-16 text-red-500">
          Failed to load entities: {error.message}
        </div>
      )}

      {!isLoading && !error && entities.length === 0 && (
        <div className="text-center py-16">
          <p className="text-muted-foreground text-lg">No {kind} entities found.</p>
          <Link to="/create/$kind" params={{ kind }}>
            <Button variant="outline" className="mt-4">
              Create the first one
            </Button>
          </Link>
        </div>
      )}

      {!isLoading && entities.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entities.map((entity) => (
            <Link
              key={entity.id}
              to="/wiki/entity/$id"
              params={{ id: entity.id }}
              className="block"
            >
              <Card className="h-full bg-zinc-900 border-zinc-800 hover:border-violet-600 hover:shadow-lg hover:shadow-violet-600/10 transition-all cursor-pointer">
                <div className="aspect-video w-full overflow-hidden rounded-t-lg relative bg-zinc-800">
                  <div className="absolute inset-0 flex items-center justify-center">
                    {(() => {
                      const Icon = KIND_ICONS[kind];
                      return <Icon className="h-10 w-10 text-muted-foreground/30" />;
                    })()}
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
                <CardHeader className="pb-2">
                  <CardTitle className="text-base leading-snug">{entity.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Badge variant="secondary" className="mb-2 text-xs">
                    {kind}
                  </Badge>
                  {entity.description && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {entity.description}
                    </p>
                  )}
                  {entity.universeAddress && (
                    <Badge variant="outline" className="mt-2 text-xs font-mono truncate max-w-full">
                      {entity.universeAddress.slice(0, 10)}...
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/wiki/$kind')({
  component: WikiKindPage,
});

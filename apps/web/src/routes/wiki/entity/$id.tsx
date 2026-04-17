/**
 * Entity detail page — shows a single worldbuilding entity.
 *
 * Route: /wiki/entity/:id
 * Works for all creator kinds: person, place, thing, faction, event, lore, etc.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Sparkles, Loader2 } from 'lucide-react';
import { MediaGallery } from '@/components/MediaGallery';
import { useMediaAttachments } from '@/hooks/useMediaAttachments';

const KIND_LABELS: Record<string, string> = {
  person: 'Person',
  place: 'Place',
  thing: 'Thing / Artifact',
  faction: 'Faction',
  event: 'Event',
  lore: 'Lore Page',
  species: 'Species',
  vehicle: 'Vehicle',
  technology: 'Technology',
  organization: 'Organization',
  timeline: 'Timeline',
  reality: 'Reality',
  dimension: 'Dimension',
  plane: 'Plane',
  realm: 'Realm',
  domain: 'Domain',
};

const METADATA_LABELS: Record<string, string> = {
  role: 'Role / Archetype',
  appearance: 'Appearance',
  motivations: 'Motivations',
  abilities: 'Abilities',
  homePlace: 'Home / Origin',
  affiliations: 'Affiliations',
  placeType: 'Type',
  atmosphere: 'Atmosphere',
  rulesAndDangers: 'Rules / Dangers',
  inhabitants: 'Inhabitants',
  governingFaction: 'Governing Faction',
  thingType: 'Type',
  origin: 'Origin',
  powersAndUse: 'Powers / Use',
  rarity: 'Rarity',
  currentOwner: 'Current Owner',
  mission: 'Mission',
  ideology: 'Ideology',
  leader: 'Leader',
  rivals: 'Rivals',
  hq: 'Headquarters',
  resources: 'Resources',
  era: 'Date / Era',
  participants: 'Participants',
  location: 'Location',
  causes: 'Causes',
  outcome: 'Outcome',
  canonStatus: 'Canon Status',
  loreType: 'Type',
  article: 'Article',
  relatedConcepts: 'Related Concepts',
  canonWeight: 'Canon Weight',
  biologicalType: 'Biological Type',
  traits: 'Defining Traits',
  homeworld: 'Homeworld',
  culture: 'Culture',
  vehicleType: 'Type',
  crew: 'Crew / Operator',
  capabilities: 'Capabilities',
  currentStatus: 'Current Status',
  techType: 'Type',
  inventor: 'Inventor',
  howItWorks: 'How It Works',
  limitations: 'Limitations',
  users: 'Primary Users',
  orgType: 'Type',
  purpose: 'Purpose',
  structure: 'Structure',
  members: 'Notable Members',
  influence: 'Influence / Reach',
};

const safeUrl = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
};

function EntityPage() {
  const { id } = Route.useParams();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const {
    data: entity,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['entity', id],
    queryFn: () => trpcClient.entities.get.query({ entityId: id }),
  });

  const { data: mediaAttachments = [] } = useMediaAttachments('entity', id);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-16 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error || !entity) {
    return (
      <div className="container mx-auto p-6">
        <Link to="/wiki">
          <Button variant="outline" className="mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Wiki
          </Button>
        </Link>
        <div className="text-center py-16 text-red-500">{error?.message ?? 'Entity not found'}</div>
      </div>
    );
  }

  const kindLabel = KIND_LABELS[entity.kind] ?? entity.kind;
  const metadataEntries = Object.entries(entity.metadata ?? {}).filter(([, v]) => v);
  const isOwner = !!address && entity.creator?.toLowerCase() === address.toLowerCase();

  const handleGenerateBio = async () => {
    setGenerating(true);
    try {
      const profile = await trpcClient.entities.generateProfile.mutate({
        name: entity.name,
        kind: entity.kind,
        hint: entity.description || '',
      });
      // Update entity with generated profile
      await trpcClient.entities.update.mutate({
        entityId: id,
        description: profile.description,
        metadata: { ...(entity.metadata ?? {}), ...profile.metadata } as Record<
          string,
          string | number | boolean | null
        >,
      });
      queryClient.invalidateQueries({ queryKey: ['entity', id] });
      toast.success('AI bio generated and saved!');
    } catch (err: any) {
      toast.error(err.message ?? 'AI generation failed');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Link to="/wiki">
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Wiki
        </Button>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — image + metadata */}
        <div className="space-y-4">
          {safeUrl(entity.imageUrl) && (
            <Card>
              <CardContent className="p-4">
                <div className="aspect-square w-full overflow-hidden rounded-lg">
                  <img
                    src={safeUrl(entity.imageUrl)}
                    alt={entity.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <Badge variant="secondary">{kindLabel}</Badge>
              </div>
              {entity.universeAddress && (
                <div className="flex justify-between items-center gap-2">
                  <span className="text-muted-foreground">Universe</span>
                  <Link
                    to="/universe/$id"
                    params={{ id: entity.universeAddress }}
                    className="text-primary text-xs font-mono hover:underline truncate max-w-[120px]"
                  >
                    {entity.universeAddress.slice(0, 10)}…
                  </Link>
                </div>
              )}
              {(entity as any).unstoppableDomain && (
                <div className="flex justify-between items-center gap-2">
                  <span className="text-muted-foreground">Domain</span>
                  <span className="text-xs font-medium text-primary">
                    {(entity as any).unstoppableDomain}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(entity.createdAt).toLocaleDateString()}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column — name, description, metadata fields */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <CardTitle className="text-2xl">{entity.name}</CardTitle>
              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateBio}
                  disabled={generating}
                  className="shrink-0"
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  {generating ? 'Generating...' : 'Generate Bio'}
                </Button>
              )}
            </CardHeader>
            {entity.description && (
              <CardContent>
                <p className="text-muted-foreground leading-relaxed">{entity.description}</p>
              </CardContent>
            )}
          </Card>

          {metadataEntries.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">World Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {metadataEntries.map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      {METADATA_LABELS[key] ?? key}
                    </dt>
                    <dd className="text-sm leading-relaxed whitespace-pre-wrap">{String(value)}</dd>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {(mediaAttachments.length > 0 || isOwner) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  Media &amp; Assets
                  {isOwner && (
                    <Link to="/upload" search={{}}>
                      <button className="text-xs font-normal text-primary hover:underline">
                        + Upload &amp; attach
                      </button>
                    </Link>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MediaGallery targetType="entity" targetId={id} isOwner={isOwner} />
                {mediaAttachments.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No media attached yet.{' '}
                    <Link to="/upload" search={{}} className="text-primary hover:underline">
                      Upload a file
                    </Link>{' '}
                    to attach artwork, 3D models, textures, animations, rigs, video, music, sound
                    effects, or design files. Generate 3D models and they'll auto-attach here.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/wiki/entity/$id')({
  component: EntityPage,
});

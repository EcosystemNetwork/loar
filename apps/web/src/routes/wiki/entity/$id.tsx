/**
 * Entity detail page — shows a single worldbuilding entity.
 *
 * Route: /wiki/entity/:id
 * Works for all creator kinds: person, place, thing, faction, event, lore, etc.
 *
 * Includes:
 *   - Character pipeline status (2D → 3D → Textured)
 *   - Inline image gallery and 3D model viewer
 *   - Music generation panel
 *   - Collaborative editing
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { toast } from 'sonner';
import { UserText } from '@/components/user-text';
import { trpcClient } from '@/utils/trpc';
import { requireProviderKey } from '@/lib/apiKeyGate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  Music,
  Users,
  Wand2,
  CheckCircle2,
  Circle,
  XCircle,
  Box,
  ShieldCheck,
  Plus,
  Trash2,
  Search,
  Tag,
  Settings2,
  Upload,
} from 'lucide-react';
import { MediaGallery } from '@/components/MediaGallery';
import { Entity3DStudio } from '@/components/world/Entity3DStudio';
import { CharacterProfileCard } from '@/components/wiki/CharacterProfileCard';
import {
  ArticleSection,
  EntityArticleHero,
  EntityInfobox,
  type InfoboxRow,
} from '@/components/wiki/EntityArticle';
import { kindIcon, KIND_LABELS } from '@/components/wiki/kindMeta';
import { splitMetadata } from '@/components/wiki/frontPage';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useMediaAttachments } from '@/hooks/useMediaAttachments';
import { MusicGenerationPanel } from '@/components/MusicGenerationPanel';
import { MintContentDialog } from '@/components/MintContentDialog';
import { CollaborativeEntityEditor } from '@/components/collaboration/CollaborativeEntityEditor';
import { VoiceProfileCard } from '@/components/VoiceProfileCard';
import { ReferenceBundleEditor } from '@/components/ReferenceBundleEditor';
import { CanonStylePackToggle } from '@/components/CanonStylePackToggle';
import { useIsUniverseAdmin } from '@/hooks/useIsUniverseAdmin';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SmartImage } from '@/components/SmartImage';
import { EndorseButton } from '@/components/curation/EndorseButton';

// Firestore Timestamps serialize to {_seconds, _nanoseconds} over JSON, which
// `new Date(...)` can't parse. Accept both the serialized shape and native
// Date/number/string representations.
function formatEntityDate(v: unknown): string {
  if (!v) return '—';
  const d =
    typeof v === 'object' && v !== null && '_seconds' in v
      ? new Date((v as { _seconds: number })._seconds * 1000)
      : new Date(v as string | number | Date);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

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

/** Kinds eligible for the character pipeline (have visual 3D representations). */
const PIPELINE_ELIGIBLE_KINDS = ['person', 'species', 'vehicle', 'technology', 'thing'];

/** Step status labels for pipeline progress display. */
const PIPELINE_STEPS = [
  { key: 'imagen_2d', label: '2D Art (Google Imagen)' },
  { key: 'meshy_3d', label: '3D Model (Meshy)' },
  { key: 'meshy_texture', label: 'Textured 3D (Meshy)' },
] as const;

function getStepStatus(
  currentStep: string,
  stepKey: string
): 'done' | 'active' | 'pending' | 'failed' {
  const order = [
    'queued',
    'imagen_2d',
    'imagen_2d_complete',
    'meshy_3d',
    'meshy_3d_complete',
    'meshy_texture',
    'completed',
  ];
  const currentIdx = order.indexOf(currentStep);
  const stepStartMap: Record<string, number> = {
    imagen_2d: 1,
    meshy_3d: 3,
    meshy_texture: 5,
  };
  const stepDoneMap: Record<string, number> = {
    imagen_2d: 2,
    meshy_3d: 4,
    meshy_texture: 6,
  };

  if (currentStep === 'failed') return 'failed';
  if (currentIdx >= stepDoneMap[stepKey]) return 'done';
  if (currentIdx >= stepStartMap[stepKey]) return 'active';
  return 'pending';
}

/** Shape of a pipeline status record from Firestore. */
interface PipelineRecord {
  id: string;
  status: string;
  currentStep?: string;
  stepProgress?: string;
  failureReason?: string;
  creditsRefunded?: boolean;
  entityId?: string;
  [key: string]: unknown;
}

/** Pipeline status card shown when a character pipeline is running or completed. */
function PipelineStatus({ pipelineId }: { pipelineId: string }) {
  const queryClient = useQueryClient();
  const { data: pipeline } = useQuery({
    queryKey: ['character-pipeline', pipelineId],
    queryFn: async () => {
      const result = await trpcClient.characterPipeline.getStatus.query({ pipelineId });
      return result as PipelineRecord | null;
    },
    refetchInterval: (query) => {
      const status = (query.state.data as PipelineRecord | null)?.status;
      if (status === 'running') return 3000;
      // When pipeline completes, refresh media attachments to show new assets
      if (status === 'completed' || status === 'failed') {
        queryClient.invalidateQueries({ queryKey: ['media-attachments'] });
        queryClient.invalidateQueries({ queryKey: ['entity'] });
      }
      return false;
    },
  });

  if (!pipeline) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Box className="w-4 h-4" />
          Character Pipeline
          {pipeline.status === 'running' && (
            <Badge variant="secondary" className="text-[10px]">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Running
            </Badge>
          )}
          {pipeline.status === 'completed' && (
            <Badge className="text-[10px] bg-green-600">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Complete
            </Badge>
          )}
          {pipeline.status === 'failed' && (
            <Badge variant="destructive" className="text-[10px]">
              <XCircle className="w-3 h-3 mr-1" />
              Failed
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Step progress */}
        <div className="space-y-1.5">
          {PIPELINE_STEPS.map((step) => {
            const status = getStepStatus(pipeline.currentStep || 'queued', step.key);
            return (
              <div key={step.key} className="flex items-center gap-2 text-sm">
                {status === 'done' && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                {status === 'active' && (
                  <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                )}
                {status === 'pending' && (
                  <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                )}
                {status === 'failed' && <XCircle className="w-4 h-4 text-destructive shrink-0" />}
                <span
                  className={
                    status === 'active'
                      ? 'text-primary font-medium'
                      : status === 'done'
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/60'
                  }
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Current progress message */}
        {pipeline.stepProgress && pipeline.status === 'running' && (
          <p className="text-xs text-muted-foreground italic">{pipeline.stepProgress}</p>
        )}

        {/* Failure reason */}
        {pipeline.failureReason && (
          <p className="text-xs text-destructive">{pipeline.failureReason}</p>
        )}

        {/* Credits */}
        {pipeline.creditsRefunded && (
          <p className="text-xs text-muted-foreground">Credits refunded due to failure.</p>
        )}
      </CardContent>
    </Card>
  );
}

const RELATION_TYPES = [
  { value: 'allied_with', label: 'Allied With' },
  { value: 'enemy_of', label: 'Enemy Of' },
  { value: 'member_of', label: 'Member Of' },
  { value: 'located_in', label: 'Located In' },
  { value: 'created_by', label: 'Created By' },
  { value: 'owns', label: 'Owns' },
  { value: 'related_to', label: 'Related To' },
  { value: 'appears_in', label: 'Appears In' },
  { value: 'rules', label: 'Rules' },
  { value: 'uses', label: 'Uses' },
] as const;

const INVERSE_LABELS: Record<string, string> = {
  allied_with: 'Allied With',
  enemy_of: 'Enemy Of',
  member_of: 'Has Member',
  located_in: 'Contains',
  created_by: 'Creator Of',
  owns: 'Owned By',
  related_to: 'Related To',
  appears_in: 'Features',
  rules: 'Ruled By',
  uses: 'Used By',
};

/** Relationships card — shows all entity connections and allows adding new ones. */
function RelationshipsCard({ entityId, isOwner }: { entityId: string; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [relationType, setRelationType] = useState('related_to');
  const [relDescription, setRelDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: relData, isLoading: loadingRels } = useQuery({
    queryKey: ['entity-relations', entityId],
    queryFn: () => trpcClient.entities.relations.query({ entityId }),
  });

  const { data: searchResults } = useQuery({
    queryKey: ['entity-search', searchQuery],
    queryFn: () => trpcClient.entities.search.query({ query: searchQuery, limit: 10 }),
    enabled: searchQuery.length >= 2,
  });

  const relations = relData?.relations ?? [];

  const handleAdd = async () => {
    if (!selectedTarget) return;
    setSaving(true);
    try {
      await trpcClient.entities.createRelation.mutate({
        sourceId: entityId,
        targetId: selectedTarget,
        type: relationType as any,
        description: relDescription,
      });
      queryClient.invalidateQueries({ queryKey: ['entity-relations', entityId] });
      setAdding(false);
      setSearchQuery('');
      setSelectedTarget(null);
      setRelDescription('');
      toast.success('Relationship added');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to add relationship');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (relationId: string) => {
    try {
      await trpcClient.entities.deleteRelation.mutate({ relationId });
      queryClient.invalidateQueries({ queryKey: ['entity-relations', entityId] });
      toast.success('Relationship removed');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to remove relationship');
    }
  };

  if (loadingRels) return null;

  // Don't render if no relations and not owner
  if (relations.length === 0 && !isOwner) return null;

  return (
    <ArticleSection
      id="relationships"
      title="Relationships"
      count={relations.length}
      action={
        isOwner && !adding ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="w-3 h-3 mr-1" />
            Add
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Add relationship form */}
        {adding && (
          <div className="space-y-3 p-3 rounded-lg border border-dashed">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search for an entity to link..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedTarget(null);
                }}
                className="pl-9"
              />
            </div>
            {searchResults?.entities && searchResults.entities.length > 0 && !selectedTarget && (
              <div className="max-h-32 overflow-y-auto space-y-1 rounded border p-1">
                {searchResults.entities
                  .filter((e: any) => e.id !== entityId)
                  .map((e: any) => (
                    <button
                      key={e.id}
                      onClick={() => {
                        setSelectedTarget(e.id);
                        setSearchQuery(e.name);
                      }}
                      className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded flex items-center gap-2"
                    >
                      {e.imageUrl ? (
                        <SmartImage
                          src={e.imageUrl}
                          alt=""
                          className="w-5 h-5 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-muted" />
                      )}
                      <span className="font-medium">{e.name}</span>
                      <Badge variant="outline" className="text-[10px] ml-auto">
                        {e.kind}
                      </Badge>
                    </button>
                  ))}
              </div>
            )}
            <div className="flex gap-2">
              <Select value={relationType} onValueChange={setRelationType}>
                <SelectTrigger className="w-40 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATION_TYPES.map((rt) => (
                    <SelectItem key={rt.value} value={rt.value} className="text-xs">
                      {rt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Description (optional)"
                value={relDescription}
                onChange={(e) => setRelDescription(e.target.value)}
                className="h-8 text-xs flex-1"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setSearchQuery('');
                  setSelectedTarget(null);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleAdd} disabled={!selectedTarget || saving}>
                {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                Add Relationship
              </Button>
            </div>
          </div>
        )}

        {/* Existing relationships */}
        {relations.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">
            No connections yet. Add relationships to build your universe's lore graph.
          </p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {relations.map((rel: any) => {
            const isSource = rel.sourceId === entityId;
            const otherName = isSource ? rel.targetName : rel.sourceName;
            const otherId = isSource ? rel.targetId : rel.sourceId;
            const otherKind = isSource ? rel.targetKind : rel.sourceKind;
            const otherImage = isSource ? rel.targetImageUrl : rel.sourceImageUrl;
            const label = isSource
              ? (RELATION_TYPES.find((rt) => rt.value === rel.type)?.label ?? rel.type)
              : (INVERSE_LABELS[rel.type] ?? rel.type);
            const Icon = kindIcon(otherKind);

            return (
              <li
                key={rel.id}
                className="group relative flex items-center gap-3 rounded-lg border bg-card/40 p-2.5 transition-colors hover:border-primary/40"
              >
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  <Icon className="h-5 w-5 text-muted-foreground/40" />
                  {otherImage && (
                    <SmartImage
                      src={otherImage}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                  </p>
                  <Link
                    to="/wiki/entity/$id"
                    params={{ id: otherId }}
                    className="block truncate font-medium after:absolute after:inset-0 hover:text-primary"
                  >
                    {otherName}
                  </Link>
                  {rel.description && (
                    <p className="truncate text-xs text-muted-foreground">
                      <UserText>{rel.description}</UserText>
                    </p>
                  )}
                </div>
                {isOwner && (
                  <button
                    onClick={() => handleDelete(rel.id)}
                    className="relative z-10 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    title="Remove relationship"
                    aria-label={`Remove relationship with ${otherName}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </ArticleSection>
  );
}

/** Small linked tile used by the "Contains" and "Mentioned in" sections. */
function EntityLinkTile({
  id,
  name,
  kind,
  imageUrl,
  snippet,
}: {
  id: string;
  name: string;
  kind: string;
  imageUrl?: string | null;
  snippet?: string;
}) {
  const Icon = kindIcon(kind);
  return (
    <Link
      to="/wiki/entity/$id"
      params={{ id }}
      className="flex items-start gap-3 rounded-lg border bg-card/40 p-2.5 transition-colors hover:border-primary/40"
    >
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground/40" />
        {imageUrl && (
          <SmartImage
            src={imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name}</span>
        {snippet ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">{snippet}</span>
        ) : (
          <span className="block text-xs text-muted-foreground">{KIND_LABELS[kind] ?? kind}</span>
        )}
      </span>
    </Link>
  );
}

/** Child entities section — shows direct children of this entity. */
function ChildEntities({ entityId }: { entityId: string }) {
  const { data } = useQuery({
    queryKey: ['entity-children', entityId],
    queryFn: () => trpcClient.entities.children.query({ parentId: entityId, limit: 20 }),
  });

  const children = data?.children ?? [];
  if (children.length === 0) return null;

  return (
    <ArticleSection id="contains" title="Contains" count={children.length}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {children.map((child: any) => (
          <EntityLinkTile
            key={child.id}
            id={child.id}
            name={child.name}
            kind={child.kind}
            imageUrl={child.imageUrl}
          />
        ))}
      </div>
    </ArticleSection>
  );
}

/** Backlinks — other entities in this universe whose text mentions this one by name. */
function MentionedIn({ entityId }: { entityId: string }) {
  const { data } = useQuery({
    queryKey: ['entity-mentions', entityId],
    queryFn: () => trpcClient.entities.mentions.query({ entityId }),
    staleTime: 5 * 60 * 1000,
  });

  const mentions = data?.mentions ?? [];
  if (mentions.length === 0) return null;

  return (
    <ArticleSection id="mentioned-in" title="Mentioned in" count={mentions.length}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {mentions.map((m) => (
          <EntityLinkTile
            key={m.id}
            id={m.id}
            name={m.name}
            kind={m.kind}
            imageUrl={m.imageUrl}
            snippet={m.snippet}
          />
        ))}
      </div>
    </ArticleSection>
  );
}

function EntityPage() {
  const { id } = Route.useParams();
  const { address } = useAccount();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [showMusicPanel, setShowMusicPanel] = useState(false);
  const [collaborativeMode, setCollaborativeMode] = useState(false);
  const [launchingPipeline, setLaunchingPipeline] = useState(false);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [showMintDialog, setShowMintDialog] = useState(false);
  const [mintContentId, setMintContentId] = useState<string | null>(null);
  const [findingContent, setFindingContent] = useState(false);

  const {
    data: entity,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['entity', id],
    queryFn: () => trpcClient.entities.get.query({ entityId: id }),
  });

  const { data: mediaAttachments = [] } = useMediaAttachments('entity', id);

  // Check if this entity has an active/completed pipeline
  const { data: pipelineHistory } = useQuery({
    queryKey: ['character-pipeline-history', id],
    queryFn: async () => {
      const history = await trpcClient.characterPipeline.history.query({ limit: 5 });
      return history.filter((p: any) => p.entityId === id);
    },
    enabled: !!entity && PIPELINE_ELIGIBLE_KINDS.includes(entity.kind),
  });

  // Auto-set pipelineId from history if we don't have one from this session
  useEffect(() => {
    if (!pipelineId && pipelineHistory?.length) {
      setPipelineId((pipelineHistory[0] as any).id);
    }
  }, [pipelineHistory, pipelineId]);

  // Must be called before any conditional returns (Rules of Hooks)
  const { isAdmin: isUniverseManager } = useIsUniverseAdmin(
    (entity?.universeAddress as `0x${string}` | undefined) ?? undefined
  );

  // Same key/shape as the wiki hub's scoped-universe query, so it's usually cached.
  const { data: universeResult } = useQuery({
    queryKey: ['universe', entity?.universeAddress],
    queryFn: () => trpcClient.universes.get.query({ id: entity!.universeAddress! }),
    enabled: !!entity?.universeAddress,
    staleTime: 5 * 60 * 1000,
  });
  const universeName = (universeResult?.data as { name?: string } | undefined)?.name;

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading entry">
        <Skeleton className="h-[320px] w-full rounded-none md:h-[440px]" />
        <div className="container mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
          <Skeleton className="hidden h-96 rounded-xl lg:block" />
        </div>
      </div>
    );
  }

  if (error || !entity) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="font-lore text-3xl font-semibold">This entry doesn't exist</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message ?? 'It may have been removed, or the link is wrong.'}
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/wiki">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to the wiki
          </Link>
        </Button>
      </div>
    );
  }

  const kindLabel = KIND_LABELS[entity.kind] ?? entity.kind;
  // 3D/world data is rendered by Entity3DStudio, not as raw metadata rows.
  const HIDDEN_METADATA_KEYS = new Set([
    'characterVariants',
    'modelUrl',
    'model3d',
    'puppet',
    'environment',
    'usdzUrl',
  ]);
  // Short facts sit in the infobox; long-form fields become article sections.
  // People get the structured CharacterProfileCard instead.
  const { facts: metadataFacts, sections: metadataSections } =
    entity.kind === 'person'
      ? { facts: [], sections: [] }
      : splitMetadata(entity.metadata as Record<string, unknown>, HIDDEN_METADATA_KEYS);
  const isCreator = !!address && entity.creator?.toLowerCase() === address.toLowerCase();
  const isOwner = isCreator || isUniverseManager;

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

  const handleLaunchPipeline = async () => {
    if (!entity) return;
    setLaunchingPipeline(true);
    try {
      const result = await trpcClient.characterPipeline.launch.mutate({
        name: entity.name,
        description: entity.description || `A ${entity.kind} character`,
        kind: entity.kind as any,
        universeAddress: entity.universeAddress || undefined,
        metadata: (entity.metadata as Record<string, string>) || undefined,
        characterStyle: 'realistic',
        artStyle: 'realistic',
      });
      setPipelineId(result.pipelineId);
      toast.success(`Character pipeline started! ${result.creditsCharged} credits charged.`);
      // Refresh entity data as the pipeline will update imageUrl
      queryClient.invalidateQueries({ queryKey: ['entity', id] });
      queryClient.invalidateQueries({ queryKey: ['mediaAttachments', 'entity', id] });
    } catch (err: any) {
      // The 3D pipeline needs the caller's own Google + Meshy keys (see
      // characterPipeline.launch's pre-flight check) — pop the "connect
      // your key" modal and retry once instead of just toasting a dead end.
      const provider = err?.data?.byokRequired ? err.data.provider : undefined;
      if (provider) {
        const saved = await requireProviderKey(provider, { reason: err.message });
        if (saved) {
          setLaunchingPipeline(false);
          return handleLaunchPipeline();
        }
      } else {
        toast.error(err.message ?? 'Failed to launch pipeline');
      }
    } finally {
      setLaunchingPipeline(false);
    }
  };

  const handleMintEntity = async () => {
    if (!entity) return;
    setFindingContent(true);
    try {
      // Find gallery content linked to this entity via media attachment generationIds
      const generationIds = mediaAttachments.map((a: any) => a.generationId).filter(Boolean);

      if (generationIds.length > 0) {
        // Browse gallery for matching content
        const gallery = await trpcClient.gallery.browse.query({
          origin: 'generated',
          // Scope to the entity's own universe so its content isn't buried under
          // the global newest-50 feed.
          ...(entity.universeAddress ? { universeId: entity.universeAddress } : {}),
          limit: 200,
          sortBy: 'newest',
        });
        const items = (gallery as any)?.items || [];
        // Match by generationId, prefer unminted
        const match =
          items.find((c: any) => generationIds.includes(c.generationId) && !c.mintedAsNft) ||
          items.find((c: any) => generationIds.includes(c.generationId));

        if (match) {
          if (match.mintedAsNft) {
            toast.info("This entity's artwork has already been minted as an NFT.");
            return;
          }
          setMintContentId(match.id);
          setShowMintDialog(true);
          return;
        }
      }

      // Fallback: search by entity name in gallery titles
      const gallery = await trpcClient.gallery.browse.query({
        origin: 'generated',
        ...(entity.universeAddress ? { universeId: entity.universeAddress } : {}),
        limit: 200,
        sortBy: 'newest',
      });
      const items = (gallery as any)?.items || [];
      const nameMatch = items.find(
        (c: any) => c.title?.toLowerCase().includes(entity.name.toLowerCase()) && !c.mintedAsNft
      );
      if (nameMatch) {
        setMintContentId(nameMatch.id);
        setShowMintDialog(true);
        return;
      }

      toast.error('No gallery content found for this entity. Generate artwork first, then mint.');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to find mintable content');
    } finally {
      setFindingContent(false);
    }
  };

  const isPipelineEligible = entity && PIPELINE_ELIGIBLE_KINDS.includes(entity.kind);
  const hasPipeline = !!pipelineId;
  const canMint = entity?.monetized && entity?.rightsDeclaration && entity?.imageUrl && isOwner;

  const heroImage = safeUrl(entity.imageUrl);
  const variants = (entity.metadata as any)?.characterVariants;

  const infoboxRows: InfoboxRow[] = [
    {
      label: 'Type',
      value: kindLabel,
    },
  ];
  if (entity.universeAddress) {
    infoboxRows.push({
      label: 'Universe',
      value: (
        <Link
          to="/universe/$id/watch"
          params={{ id: entity.universeAddress }}
          className="text-primary hover:underline"
        >
          {universeName ?? `${entity.universeAddress.slice(0, 10)}…`}
        </Link>
      ),
    });
  }
  for (const [key, value] of metadataFacts) {
    infoboxRows.push({ label: METADATA_LABELS[key] ?? key, value: <UserText>{value}</UserText> });
  }
  if ((entity as any).unstoppableDomain) {
    infoboxRows.push({
      label: 'Domain',
      value: <span className="text-primary">{(entity as any).unstoppableDomain}</span>,
    });
  }
  if (entity.monetized) {
    infoboxRows.push({
      label: 'Rights',
      value: (
        <Badge variant="outline" className="text-amber-500 border-amber-500/30">
          {entity.rightsDeclaration === 'original' ? 'Original' : 'Licensed'}
        </Badge>
      ),
    });
  }
  infoboxRows.push({ label: 'Created', value: formatEntityDate(entity.createdAt) });

  const showManageMenu = isOwner;

  return (
    <div className="pb-bottom-nav md:pb-12">
      <EntityArticleHero
        entity={entity as any}
        imageUrl={heroImage}
        universeName={universeName}
        actions={
          <>
            <EndorseButton
              targetType="entity"
              targetId={entity.id}
              universeAddress={entity.universeAddress ?? null}
              variant="inline"
            />
            {canMint && (
              <Button
                variant="default"
                size="sm"
                onClick={handleMintEntity}
                disabled={findingContent}
                className="bg-amber-600 hover:bg-amber-500"
              >
                {findingContent ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mr-2" />
                )}
                {findingContent ? 'Preparing...' : 'Mint as NFT'}
              </Button>
            )}
            {showManageMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="bg-background/60 backdrop-blur">
                    {generating || launchingPipeline ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Settings2 className="w-4 h-4 mr-2" />
                    )}
                    Manage entry
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem onSelect={handleGenerateBio} disabled={generating}>
                    <Sparkles className="w-4 h-4 mr-2" />
                    {generating ? 'Generating bio…' : 'Generate bio with AI'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setCollaborativeMode(true)}>
                    <Users className="w-4 h-4 mr-2" />
                    Edit collaboratively
                  </DropdownMenuItem>
                  {isPipelineEligible && !hasPipeline && (
                    <DropdownMenuItem onSelect={handleLaunchPipeline} disabled={launchingPipeline}>
                      <Wand2 className="w-4 h-4 mr-2" />
                      {launchingPipeline ? 'Starting…' : 'Generate 3D character'}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() =>
                      navigate({
                        to: '/sell/new',
                        search: {
                          assetRef: entity.id,
                          universeId: entity.universeAddress ?? undefined,
                          productType: entity.kind === 'person' ? 'CHARACTER_NFT' : 'ARTIFACT',
                          title: entity.name,
                          description: entity.description || undefined,
                          thumbnailUrl: entity.imageUrl || undefined,
                        },
                      })
                    }
                  >
                    <Tag className="w-4 h-4 mr-2" />
                    List for sale
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <div className="container mx-auto grid max-w-6xl gap-10 px-4 py-8 md:py-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        {/* Article body */}
        <article className="min-w-0 space-y-12">
          {collaborativeMode ? (
            <CollaborativeEntityEditor
              entityId={id}
              initialEntity={entity as any}
              currentUserId={address || ''}
              currentAddress={address}
              onClose={() => setCollaborativeMode(false)}
            />
          ) : (
            <>
              {entity.description ? (
                <div className="max-w-[70ch] whitespace-pre-line break-words text-[17px] leading-8 text-foreground/85 first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:font-lore first-letter:text-[3.6rem] first-letter:font-semibold first-letter:leading-[0.8] first-letter:text-primary">
                  <UserText>{entity.description}</UserText>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed px-5 py-8 text-center">
                  <p className="font-lore text-lg">
                    Nothing has been written about {entity.name} yet.
                  </p>
                  {isOwner && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={handleGenerateBio}
                      disabled={generating}
                    >
                      {generating ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4 mr-2" />
                      )}
                      {generating ? 'Generating...' : 'Draft it with AI'}
                    </Button>
                  )}
                </div>
              )}

              {entity.kind === 'person' && (
                <CharacterProfileCard
                  entityId={id}
                  metadata={(entity.metadata ?? {}) as Record<string, unknown>}
                  isOwner={isOwner}
                />
              )}

              {metadataSections.map(([key, value]) => (
                <ArticleSection key={key} id={`field-${key}`} title={METADATA_LABELS[key] ?? key}>
                  <div className="max-w-[70ch] whitespace-pre-line break-words leading-7 text-foreground/85">
                    <UserText>{value}</UserText>
                  </div>
                </ArticleSection>
              ))}
            </>
          )}

          {/* Relationships */}
          <RelationshipsCard entityId={id} isOwner={isOwner} />

          {/* Child entities */}
          <ChildEntities entityId={id} />

          {/* Backlinks */}
          <MentionedIn entityId={id} />

          {/* 3D model, puppet, environment — Tripo world-building */}
          <Entity3DStudio entity={entity} isOwner={isOwner} />

          {(mediaAttachments.length > 0 || isOwner) && (
            <ArticleSection
              id="media"
              title="Media & assets"
              count={mediaAttachments.length}
              action={
                isOwner ? (
                  <div className="flex items-center gap-3">
                    <button
                      className="text-xs font-normal text-primary hover:underline flex items-center gap-1"
                      onClick={() => setShowMusicPanel((v) => !v)}
                    >
                      <Music className="h-3 w-3" />
                      {showMusicPanel ? 'Hide music gen' : 'Generate music'}
                    </button>
                    <Link
                      to="/upload"
                      search={{}}
                      className="text-xs font-normal text-primary hover:underline flex items-center gap-1"
                    >
                      <Upload className="h-3 w-3" />
                      Upload &amp; attach
                    </Link>
                  </div>
                ) : undefined
              }
            >
              <div className="space-y-4">
                {showMusicPanel && isOwner && (
                  <MusicGenerationPanel
                    entityId={id}
                    universeId={entity.universeAddress || undefined}
                    entityName={entity.name}
                    entityKind={entity.kind}
                    onGenerated={() => {
                      queryClient.invalidateQueries({
                        queryKey: ['mediaAttachments', 'entity', id],
                      });
                    }}
                  />
                )}
                <MediaGallery targetType="entity" targetId={id} isOwner={isOwner} />
                {mediaAttachments.length === 0 && !showMusicPanel && (
                  <p className="text-sm text-muted-foreground">
                    No media attached yet.{' '}
                    <Link to="/upload" search={{}} className="text-primary hover:underline">
                      Upload a file
                    </Link>{' '}
                    to attach artwork, 3D models, textures, animations, rigs, video, music, sound
                    effects, or design files. Generate 3D models and they'll auto-attach here.
                  </p>
                )}
              </div>
            </ArticleSection>
          )}

          {/* Production tools — each card hides itself when it has nothing to show */}
          <div className="space-y-4 empty:hidden">
            {/* Character pipeline status */}
            {hasPipeline && <PipelineStatus pipelineId={pipelineId!} />}

            {/* Voice profile — design & preview character voices */}
            <VoiceProfileCard
              entityId={id}
              entityName={entity.name}
              entityKind={entity.kind}
              entityDescription={entity.description || ''}
              universeId={entity.universeAddress || null}
              isOwner={isOwner}
            />

            {/* Reference bundle — character identity lock + multi-reference editing */}
            <ReferenceBundleEditor entityId={id} isOwner={isOwner} />
          </div>
        </article>
        {/* Infobox — below the article on mobile, pinned beside it on desktop */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <EntityInfobox entity={entity as any} imageUrl={heroImage} rows={infoboxRows}>
            {/* Character variants — outfits / alternate versions captured during creation. */}
            {Array.isArray(variants) && variants.length > 0 && (
              <div className="border-t px-4 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Versions &amp; outfits
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {variants.map((v: any, idx: number) => (
                    <div
                      key={`${v.generationId ?? v.label ?? idx}`}
                      className={`relative overflow-hidden rounded-lg border-2 bg-muted/30 ${
                        v.isMain ? 'border-primary' : 'border-muted'
                      }`}
                    >
                      <div className="aspect-square w-full bg-muted/50">
                        {v.imageUrl ? (
                          <SmartImage
                            src={v.imageUrl}
                            alt={v.label ?? `Variant ${idx + 1}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                            {v.type === '3d' ? '3D' : 'No preview'}
                          </div>
                        )}
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent p-2">
                        <span className="truncate text-[11px] font-medium text-white">
                          {v.label ?? `Variant ${idx + 1}`}
                        </span>
                        <span className="shrink-0 text-[9px] uppercase tracking-wider text-white/70">
                          {v.type ?? '2d'}
                        </span>
                      </div>
                      {safeUrl(v.modelUrl) && (
                        <a
                          href={safeUrl(v.modelUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute left-1 top-1 rounded bg-violet-500/90 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-violet-600"
                        >
                          GLB
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </EntityInfobox>

          {entity.kind === 'style_pack' && entity.universeAddress && (
            <CanonStylePackToggle
              stylePackEntityId={entity.id}
              universeAddress={entity.universeAddress}
            />
          )}
        </aside>
      </div>

      {/* Mint as NFT dialog */}
      {showMintDialog && mintContentId && (
        <MintContentDialog
          contentId={mintContentId}
          contentTitle={entity.name}
          universeId={entity.universeAddress || undefined}
          onClose={() => {
            setShowMintDialog(false);
            setMintContentId(null);
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['entity', id] });
            queryClient.invalidateQueries({ queryKey: ['mediaAttachments', 'entity', id] });
          }}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/wiki/entity/$id')({
  component: EntityPage,
});

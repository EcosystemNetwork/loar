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
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { toast } from 'sonner';
import { UserText } from '@/components/user-text';
import { trpcClient } from '@/utils/trpc';
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
  Hexagon,
  Castle,
  Crown,
  ImageIcon,
  ShieldCheck,
  Link2,
  ChevronRight,
  Plus,
  Trash2,
  Search,
} from 'lucide-react';
import { MediaGallery } from '@/components/MediaGallery';
import { useMediaAttachments } from '@/hooks/useMediaAttachments';
import { MusicGenerationPanel } from '@/components/MusicGenerationPanel';
import { MintContentDialog } from '@/components/MintContentDialog';
import { SolanaMintDialog } from '@/components/SolanaMintDialog';
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
import { resolveIpfsUrl } from '@/utils/ipfs-url';
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

const DETAIL_KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            Relationships
            {relations.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {relations.length}
              </Badge>
            )}
          </span>
          {isOwner && !adding && (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="w-3 h-3 mr-1" />
              Add
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
                        <img
                          src={resolveIpfsUrl(e.imageUrl)}
                          alt=""
                          className="w-5 h-5 rounded-full object-cover"
                          onError={(ev) => {
                            ev.currentTarget.style.display = 'none';
                          }}
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
        <div className="space-y-2">
          {relations.map((rel: any) => {
            const isSource = rel.sourceId === entityId;
            const otherName = isSource ? rel.targetName : rel.sourceName;
            const otherId = isSource ? rel.targetId : rel.sourceId;
            const otherKind = isSource ? rel.targetKind : rel.sourceKind;
            const otherImage = isSource ? rel.targetImageUrl : rel.sourceImageUrl;
            const label = isSource
              ? (RELATION_TYPES.find((rt) => rt.value === rel.type)?.label ?? rel.type)
              : (INVERSE_LABELS[rel.type] ?? rel.type);

            return (
              <div
                key={rel.id}
                className="flex items-center gap-3 group p-2 rounded-md hover:bg-muted/50"
              >
                <Link to="/wiki/entity/$id" params={{ id: otherId }} className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center relative overflow-hidden">
                    {(() => {
                      const Icon = DETAIL_KIND_ICONS[otherKind] ?? Package;
                      return <Icon className="w-4 h-4 text-muted-foreground/40" />;
                    })()}
                    {otherImage && (
                      <img
                        src={otherImage}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                  </div>
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {label}
                    </Badge>
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <Link
                      to="/wiki/entity/$id"
                      params={{ id: otherId }}
                      className="text-sm font-medium hover:underline truncate"
                    >
                      {otherName}
                    </Link>
                  </div>
                  {rel.description && (
                    <p className="text-xs text-muted-foreground truncate break-words">
                      <UserText>{rel.description}</UserText>
                    </p>
                  )}
                </div>
                {isOwner && (
                  <button
                    onClick={() => handleDelete(rel.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    title="Remove relationship"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/** Parent chain breadcrumb — walks up the parent hierarchy. */
function EntityBreadcrumb({ entity }: { entity: any }) {
  const { data: parent } = useQuery({
    queryKey: ['entity', entity.parentId],
    queryFn: () => trpcClient.entities.get.query({ entityId: entity.parentId }),
    enabled: !!entity.parentId,
  });

  if (!entity.parentId) return null;

  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
      {parent && (
        <>
          {parent.parentId && <span className="text-muted-foreground/40">... /</span>}
          <Link
            to="/wiki/entity/$id"
            params={{ id: parent.id }}
            className="hover:underline hover:text-foreground"
          >
            {parent.name}
          </Link>
          <ChevronRight className="w-3 h-3" />
        </>
      )}
      <span className="text-foreground font-medium">{entity.name}</span>
    </div>
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contains ({children.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {children.map((child: any) => {
            const Icon = DETAIL_KIND_ICONS[child.kind] ?? Package;
            return (
              <Link
                key={child.id}
                to="/wiki/entity/$id"
                params={{ id: child.id }}
                className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors"
              >
                <div className="w-6 h-6 rounded bg-muted flex items-center justify-center relative overflow-hidden shrink-0">
                  <Icon className="w-4 h-4 text-muted-foreground/40" />
                  {child.imageUrl && (
                    <img
                      src={resolveIpfsUrl(child.imageUrl)}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                </div>
                <span className="text-sm truncate">{child.name}</span>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function EntityPage() {
  const { id } = Route.useParams();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [showMusicPanel, setShowMusicPanel] = useState(false);
  const [collaborativeMode, setCollaborativeMode] = useState(false);
  const [launchingPipeline, setLaunchingPipeline] = useState(false);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [showMintDialog, setShowMintDialog] = useState(false);
  const [mintContentId, setMintContentId] = useState<string | null>(null);
  const [findingContent, setFindingContent] = useState(false);
  const [showSolanaMint, setShowSolanaMint] = useState(false);

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
  const HIDDEN_METADATA_KEYS = new Set(['characterVariants', 'modelUrl']);
  const metadataEntries = Object.entries(entity.metadata ?? {}).filter(
    ([k, v]) => v && !HIDDEN_METADATA_KEYS.has(k)
  );
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
      queryClient.invalidateQueries({ queryKey: ['media-attachments', 'entity', id] });
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to launch pipeline');
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
          limit: 50,
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
        limit: 50,
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

  return (
    <div className="container mx-auto px-4 py-6 md:py-8 max-w-4xl pb-bottom-nav md:pb-12">
      <Link to="/wiki">
        <Button variant="outline" className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Wiki
        </Button>
      </Link>

      <EntityBreadcrumb entity={entity} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — image + metadata */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="aspect-square w-full overflow-hidden rounded-lg">
                {safeUrl(entity.imageUrl) ? (
                  <img
                    src={resolveIpfsUrl(safeUrl(entity.imageUrl))}
                    alt={entity.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-full h-full bg-muted flex flex-col items-center justify-center gap-3">
                    {(() => {
                      const Icon = DETAIL_KIND_ICONS[entity.kind] ?? ImageIcon;
                      return <Icon className="h-16 w-16 text-muted-foreground/20" />;
                    })()}
                    <span className="text-xs text-muted-foreground/40">No image yet</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Character variants — outfits / alternate versions captured during creation. */}
          {(() => {
            const variants = (entity.metadata as any)?.characterVariants;
            if (!Array.isArray(variants) || variants.length === 0) return null;
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Versions & Outfits
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                  {variants.map((v: any, idx: number) => (
                    <div
                      key={`${v.generationId ?? v.label ?? idx}`}
                      className={`relative rounded-lg border-2 overflow-hidden bg-muted/30 ${
                        v.isMain ? 'border-primary' : 'border-muted'
                      }`}
                    >
                      <div className="aspect-square w-full bg-muted/50">
                        {v.imageUrl ? (
                          <img
                            src={resolveIpfsUrl(v.imageUrl)}
                            alt={v.label ?? `Variant ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                            {v.type === '3d' ? '3D' : 'No preview'}
                          </div>
                        )}
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 flex items-center justify-between gap-1">
                        <span className="text-[11px] text-white font-medium truncate">
                          {v.label ?? `Variant ${idx + 1}`}
                        </span>
                        <span className="text-[9px] uppercase tracking-wider text-white/70 shrink-0">
                          {v.type ?? '2d'}
                        </span>
                      </div>
                      {v.modelUrl && (
                        <a
                          href={v.modelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute top-1 left-1 rounded bg-violet-500/90 text-white text-[9px] px-1.5 py-0.5 font-medium hover:bg-violet-600"
                        >
                          GLB
                        </a>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })()}

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
                    to="/universe/$id/watch"
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
              {entity.monetized && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Rights</span>
                  <Badge variant="outline" className="text-amber-500 border-amber-500/30">
                    {entity.rightsDeclaration === 'original' ? 'Original' : 'Licensed'}
                  </Badge>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatEntityDate(entity.createdAt)}</span>
              </div>
            </CardContent>
          </Card>

          {entity.kind === 'style_pack' && entity.universeAddress && (
            <CanonStylePackToggle
              stylePackEntityId={entity.id}
              universeAddress={entity.universeAddress}
            />
          )}
        </div>

        {/* Right column — name, description, metadata fields */}
        <div className="lg:col-span-2 space-y-4">
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
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <CardTitle className="text-2xl">{entity.name}</CardTitle>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
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
                    {/* Solana cNFT mint — independent of the EVM "Mint as NFT" path.
                        Available to anyone (no canMint gate) since cNFTs are
                        ~$0.0001 — there's no economic reason to restrict. */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSolanaMint(true)}
                      className="border-purple-700 text-purple-300 hover:bg-purple-950/40"
                    >
                      ◎ Mint on Solana
                    </Button>
                    {isOwner && isPipelineEligible && !hasPipeline && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleLaunchPipeline}
                        disabled={launchingPipeline}
                      >
                        {launchingPipeline ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Wand2 className="w-4 h-4 mr-2" />
                        )}
                        {launchingPipeline ? 'Starting...' : 'Generate 3D Character'}
                      </Button>
                    )}
                    {isOwner && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCollaborativeMode(true)}
                      >
                        <Users className="w-4 h-4 mr-2" />
                        Collaborate
                      </Button>
                    )}
                    {isOwner && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleGenerateBio}
                        disabled={generating}
                      >
                        {generating ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 mr-2" />
                        )}
                        {generating ? 'Generating...' : 'Generate Bio'}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                {entity.description && (
                  <CardContent>
                    <p className="text-muted-foreground leading-relaxed break-words">
                      <UserText>{entity.description}</UserText>
                    </p>
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
                        <dd className="text-sm leading-relaxed whitespace-pre-wrap">
                          {String(value)}
                        </dd>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}

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

          {/* Relationships */}
          <RelationshipsCard entityId={id} isOwner={isOwner} />

          {/* Child entities */}
          <ChildEntities entityId={id} />

          {/* Character pipeline status */}
          {hasPipeline && <PipelineStatus pipelineId={pipelineId!} />}

          {(mediaAttachments.length > 0 || isOwner) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  Media &amp; Assets
                  <div className="flex items-center gap-2">
                    {isOwner && (
                      <button
                        className="text-xs font-normal text-primary hover:underline flex items-center gap-1"
                        onClick={() => setShowMusicPanel((v) => !v)}
                      >
                        <Music className="h-3 w-3" />
                        {showMusicPanel ? 'Hide Music Gen' : 'Generate Music'}
                      </button>
                    )}
                    {isOwner && (
                      <Link to="/upload" search={{}}>
                        <button className="text-xs font-normal text-primary hover:underline">
                          + Upload &amp; attach
                        </button>
                      </Link>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {showMusicPanel && isOwner && (
                  <MusicGenerationPanel
                    entityId={id}
                    universeId={entity.universeAddress || undefined}
                    entityName={entity.name}
                    entityKind={entity.kind}
                    onGenerated={() => {
                      queryClient.invalidateQueries({
                        queryKey: ['media-attachments', 'entity', id],
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
              </CardContent>
            </Card>
          )}
        </div>
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
            queryClient.invalidateQueries({ queryKey: ['media-attachments', 'entity', id] });
          }}
        />
      )}

      {/* Solana cNFT mint dialog — uses VITE_SOLANA_DEMO_UNIVERSE for v1.
          Metadata URI falls back to entity image or a platform default. */}
      <SolanaMintDialog
        open={showSolanaMint}
        onClose={() => setShowSolanaMint(false)}
        entityName={entity.name}
        metadataUri={entity.imageUrl || 'https://loar.fun/og/entity.json'}
      />
    </div>
  );
}

export const Route = createFileRoute('/wiki/entity/$id')({
  component: EntityPage,
});

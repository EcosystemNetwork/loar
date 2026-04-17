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
} from 'lucide-react';
import { MediaGallery } from '@/components/MediaGallery';
import { useMediaAttachments } from '@/hooks/useMediaAttachments';
import { MusicGenerationPanel } from '@/components/MusicGenerationPanel';
import { CollaborativeEntityEditor } from '@/components/collaboration/CollaborativeEntityEditor';

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

function EntityPage() {
  const { id } = Route.useParams();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [showMusicPanel, setShowMusicPanel] = useState(false);
  const [collaborativeMode, setCollaborativeMode] = useState(false);
  const [launchingPipeline, setLaunchingPipeline] = useState(false);
  const [pipelineId, setPipelineId] = useState<string | null>(null);

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

  const isPipelineEligible = entity && PIPELINE_ELIGIBLE_KINDS.includes(entity.kind);
  const hasPipeline = !!pipelineId;

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
    </div>
  );
}

export const Route = createFileRoute('/wiki/entity/$id')({
  component: EntityPage,
});

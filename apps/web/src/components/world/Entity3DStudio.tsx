/**
 * Entity3DStudio — the wiki entity page's "3D & World" card.
 *
 * Everyone sees what the entity already has in 3D (model + AR, puppet
 * turnaround + motion clips, place environment). Managers get the Tripo
 * actions that build it: generate, puppet, parts kit, restyle, stylize,
 * export, environment. Jobs run server-side; progress streams in here.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bone,
  Box,
  Boxes,
  Clapperboard,
  Download,
  Footprints,
  Loader2,
  Map as MapIcon,
  Paintbrush,
  PersonStanding,
  Puzzle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ModelViewer } from '@/components/ModelViewerLazy';
import { SmartImage } from '@/components/SmartImage';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';
import { JOB_LABELS, jobProgress, useEntityTripoJobs, type TripoJob } from './useTripoJob';

export const MODELABLE_KINDS = ['person', 'species', 'thing', 'vehicle', 'technology'];
export const PUPPET_KINDS = ['person', 'species', 'vehicle'];
export const ENVIRONMENT_KINDS = ['place', 'realm', 'plane', 'dimension'];

const RIG_TYPES = [
  { id: 'biped', label: 'Biped (humanoid)' },
  { id: 'quadruped', label: 'Quadruped' },
  { id: 'avian', label: 'Avian' },
  { id: 'serpentine', label: 'Serpentine' },
  { id: 'aquatic', label: 'Aquatic' },
  { id: 'hexapod', label: 'Hexapod (insect)' },
  { id: 'octopod', label: 'Octopod (spider)' },
] as const;
type RigType = (typeof RIG_TYPES)[number]['id'];

const EXPORT_FORMATS = [
  { id: 'USDZ', label: 'USDZ — iPhone AR' },
  { id: 'FBX', label: 'FBX — Unity / Unreal / Blender' },
  { id: 'OBJ', label: 'OBJ' },
  { id: 'STL', label: 'STL — 3D printing' },
  { id: '3MF', label: '3MF — 3D printing' },
] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number]['id'];

interface Puppet {
  turnaround?: Partial<Record<'front' | 'left' | 'back' | 'right', string>>;
  riggedModelUrl?: string;
  modelUrl?: string;
  /** Web-optimised copies (meshopt, ~20x smaller) — what the viewer loads. */
  webModelUrl?: string | null;
  webRiggedModelUrl?: string | null;
  thumbnailUrl?: string | null;
  rigType?: string;
  animations?: Array<{ preset: string; name: string; url: string; webUrl?: string | null }>;
}

interface EntityLike {
  id: string;
  name: string;
  kind: string;
  imageUrl?: string | null;
  universeAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

const url = (u: string | null | undefined) => (u ? resolveIpfsUrlPreferred(u) : '');

export function Entity3DStudio({ entity, isOwner }: { entity: EntityLike; isOwner: boolean }) {
  const meta = (entity.metadata ?? {}) as Record<string, any>;
  const puppet = (meta.puppet ?? null) as Puppet | null;
  const environment = (meta.environment ?? null) as { splatUrl?: string; format?: string } | null;
  const modelUrl: string | null =
    puppet?.modelUrl ?? meta.model3d?.glbUrl ?? (meta.modelUrl as string | undefined) ?? null;
  // What the viewer loads: the web copy of the same model when there is one.
  const displayModelUrl: string | null = puppet?.modelUrl
    ? (puppet.webModelUrl ?? puppet.modelUrl)
    : meta.model3d?.glbUrl
      ? (meta.model3d.webGlbUrl ?? meta.model3d.glbUrl)
      : modelUrl;
  const posterUrl: string | null = puppet?.thumbnailUrl ?? meta.model3d?.thumbnailUrl ?? null;
  const usdzUrl = (meta.usdzUrl as string | undefined) ?? null;

  const modelable = MODELABLE_KINDS.includes(entity.kind);
  const puppetable = PUPPET_KINDS.includes(entity.kind);
  const isPlace = ENVIRONMENT_KINDS.includes(entity.kind);

  const jobsQuery = useEntityTripoJobs(entity.id, isOwner);
  const jobs = jobsQuery.data ?? [];
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const busy = (kind: string) => running.some((j) => j.kind === kind);

  const [rigType, setRigType] = useState<RigType>(entity.kind === 'person' ? 'biped' : 'quadruped');
  const [rigExistingType, setRigExistingType] = useState<RigType | 'auto'>('auto');
  const [clip, setClip] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('USDZ');
  const [restylePrompt, setRestylePrompt] = useState('');

  const onStarted = (label: string) => () =>
    toast.success(`${label} started`, { description: 'Runs in the background — usually 1–5 min.' });
  const onError = (err: unknown) => {
    // byokRequired errors open the global "add your key" modal (query-client.ts).
    const e = err as { data?: { byokRequired?: boolean }; message?: string };
    if (!e?.data?.byokRequired) toast.error(e?.message ?? 'Something went wrong');
  };
  const refresh = () => void jobsQuery.refetch();

  const generate = useMutation({
    mutationFn: (quality: 'hifi' | 'game') =>
      trpcClient.tripo.entityTo3D.mutate({ entityId: entity.id, quality }),
    onSuccess: () => {
      onStarted('3D model')();
      refresh();
    },
    onError,
  });
  const buildPuppet = useMutation({
    mutationFn: () => trpcClient.tripo.characterPuppet.mutate({ entityId: entity.id, rigType }),
    onSuccess: () => {
      onStarted('Puppet')();
      refresh();
    },
    onError,
  });
  const rigModel = useMutation({
    mutationFn: () =>
      trpcClient.tripo.rigEntityModel.mutate({ entityId: entity.id, rigType: rigExistingType }),
    onSuccess: () => {
      onStarted('Rig')();
      refresh();
    },
    onError,
  });
  const source = { entityId: entity.id };
  const segment = useMutation({
    mutationFn: () => trpcClient.tripo.segment.mutate({ source }),
    onSuccess: () => {
      onStarted('Parts kit')();
      refresh();
    },
    onError,
  });
  const restyle = useMutation({
    mutationFn: () =>
      trpcClient.tripo.restyle.mutate({
        source,
        text: restylePrompt.trim() || undefined,
        useCanonStyle: !restylePrompt.trim(),
      }),
    onSuccess: () => {
      onStarted('Restyle')();
      refresh();
    },
    onError,
  });
  const stylize = useMutation({
    mutationFn: (style: 'lego' | 'voxel' | 'minecraft') =>
      trpcClient.tripo.stylize.mutate({ source, style }),
    onSuccess: () => {
      onStarted('Stylize')();
      refresh();
    },
    onError,
  });
  const convert = useMutation({
    mutationFn: () =>
      trpcClient.tripo.convert.mutate({
        source,
        format: exportFormat,
        quad: exportFormat === 'FBX',
        fbxPreset: exportFormat === 'FBX' ? 'blender' : undefined,
      }),
    onSuccess: () => {
      onStarted('Export')();
      refresh();
    },
    onError,
  });
  const buildEnvironment = useMutation({
    mutationFn: () => trpcClient.tripo.placeEnvironment.mutate({ entityId: entity.id }),
    onSuccess: () => {
      onStarted('Environment')();
      refresh();
    },
    onError,
  });

  const hasAnything = !!(modelUrl || puppet?.turnaround || environment?.splatUrl);
  if (!hasAnything && !isOwner) return null;
  if (!modelable && !isPlace) return null;

  const activeClip = puppet?.animations?.find((a) => a.name === clip) ?? null;
  const viewerSrc = activeClip ? (activeClip.webUrl ?? activeClip.url) : displayModelUrl;
  const finishedExports = jobs.filter((j) => j.kind === 'convert' && j.status === 'completed');
  const partsKits = jobs.filter((j) => j.kind === 'segment' && j.status === 'completed');
  const noArt = !entity.imageUrl;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="h-4 w-4" />
          3D &amp; World
          {running.length > 0 && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Loader2 className="h-3 w-3 animate-spin" />
              {running.length} building
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── Model / puppet viewer ─────────────────────────────── */}
        {modelable && viewerSrc && (
          <div className="space-y-2">
            <ModelViewer
              key={viewerSrc}
              src={url(viewerSrc)}
              poster={activeClip ? undefined : url(posterUrl) || undefined}
              alt={`${entity.name} 3D model`}
              iosSrc={activeClip ? null : url(usdzUrl) || null}
              autoplay={!!activeClip}
              className="aspect-square max-h-[380px] w-full"
            />
            {!!puppet?.animations?.length && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground mr-1">Motion:</span>
                <Button
                  size="sm"
                  variant={clip === null ? 'default' : 'outline'}
                  className="h-7 px-2 text-xs"
                  onClick={() => setClip(null)}
                >
                  Static
                </Button>
                {puppet.animations.map((a) => (
                  <Button
                    key={a.name}
                    size="sm"
                    variant={clip === a.name ? 'default' : 'outline'}
                    className="h-7 px-2 text-xs capitalize"
                    onClick={() => setClip(a.name)}
                  >
                    {a.name}
                  </Button>
                ))}
              </div>
            )}
            {usdzUrl && (
              <p className="text-xs text-muted-foreground">
                On a phone, tap the AR button to place {entity.name} in your room.
              </p>
            )}
          </div>
        )}

        {/* ── Turnaround (consistency refs) ─────────────────────── */}
        {puppet?.turnaround && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <PersonStanding className="h-4 w-4" />
              Turnaround
              <span className="text-xs font-normal text-muted-foreground">
                — used as character references so videos stay on-model
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['front', 'left', 'back', 'right'] as const).map((v) =>
                puppet.turnaround?.[v] ? (
                  <figure key={v} className="space-y-1">
                    <SmartImage
                      src={puppet.turnaround[v]!}
                      alt={`${entity.name} — ${v}`}
                      className="aspect-square w-full rounded-md border object-contain bg-muted/30"
                    />
                    <figcaption className="text-center text-[11px] capitalize text-muted-foreground">
                      {v}
                    </figcaption>
                  </figure>
                ) : null
              )}
            </div>
          </div>
        )}

        {/* ── Place environment ─────────────────────────────────── */}
        {isPlace && environment?.splatUrl && entity.universeAddress && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm">
              <MapIcon className="h-4 w-4" />
              Explorable environment ready
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/universe/$id/world" params={{ id: entity.universeAddress }}>
                Build a set here
              </Link>
            </Button>
          </div>
        )}

        {/* ── Manager actions ───────────────────────────────────── */}
        {isOwner && (
          <div className="space-y-4">
            {noArt && (
              <p className="text-xs text-muted-foreground">
                Add cover art to this entity first — 3D is generated from it.
              </p>
            )}

            {modelable && (
              <ActionRow
                icon={<Box className="h-4 w-4" />}
                title={modelUrl ? 'Regenerate 3D model' : 'Generate 3D model'}
                hint="From the cover art. High detail for close-ups; game-ready for sets and export."
              >
                <Button
                  size="sm"
                  disabled={noArt || busy('entity_model') || generate.isPending}
                  onClick={() => generate.mutate('hifi')}
                >
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  High detail
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={noArt || busy('entity_model') || generate.isPending}
                  onClick={() => generate.mutate('game')}
                >
                  Game-ready
                </Button>
              </ActionRow>
            )}

            {puppetable && modelUrl && (
              <ActionRow
                icon={<Bone className="h-4 w-4" />}
                title={puppet?.riggedModelUrl ? 'Re-rig this model' : 'Rig this model'}
                hint="Skeleton + idle/walk clips on the 3D model above, with no new body. Auto-detect lets Tripo pick humanoid, quadruped, spider, snake, and so on."
              >
                <Select
                  value={rigExistingType}
                  onValueChange={(v) => setRigExistingType(v as RigType | 'auto')}
                >
                  <SelectTrigger className="h-8 w-[170px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto" className="text-xs">
                      Auto-detect
                    </SelectItem>
                    {RIG_TYPES.map((r) => (
                      <SelectItem key={r.id} value={r.id} className="text-xs">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={busy('rig_model') || busy('character_puppet') || rigModel.isPending}
                  onClick={() => rigModel.mutate()}
                >
                  Rig
                </Button>
              </ActionRow>
            )}

            {puppetable && (
              <ActionRow
                icon={<Footprints className="h-4 w-4" />}
                title={puppet?.riggedModelUrl ? 'Rebuild puppet' : 'Build character puppet'}
                hint="Turnaround sheet → 3D body → skeleton → idle/walk/run clips. The turnaround also locks this character's look in video generation."
              >
                <Select value={rigType} onValueChange={(v) => setRigType(v as RigType)}>
                  <SelectTrigger className="h-8 w-[170px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RIG_TYPES.map((r) => (
                      <SelectItem key={r.id} value={r.id} className="text-xs">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={noArt || busy('character_puppet') || buildPuppet.isPending}
                  onClick={() => buildPuppet.mutate()}
                >
                  Build puppet
                </Button>
              </ActionRow>
            )}

            {isPlace && (
              <ActionRow
                icon={<MapIcon className="h-4 w-4" />}
                title={
                  environment?.splatUrl ? 'Rebuild environment' : 'Build explorable environment'
                }
                hint="Turns this place's art into a 3D Gaussian-splat scene you can stage sets in and walk through."
              >
                <Button
                  size="sm"
                  disabled={noArt || busy('place_splat') || buildEnvironment.isPending}
                  onClick={() => buildEnvironment.mutate()}
                >
                  Build environment
                </Button>
              </ActionRow>
            )}

            {modelable && modelUrl && (
              <>
                <ActionRow
                  icon={<Paintbrush className="h-4 w-4" />}
                  title="Restyle"
                  hint="Re-texture to match the universe's canon style pack, or describe a look."
                >
                  <Input
                    value={restylePrompt}
                    onChange={(e) => setRestylePrompt(e.target.value)}
                    placeholder="Blank = canon style pack"
                    className="h-8 w-[220px] text-xs"
                    maxLength={1024}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy('restyle') || restyle.isPending}
                    onClick={() => restyle.mutate()}
                  >
                    Restyle
                  </Button>
                  {(['lego', 'voxel', 'minecraft'] as const).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant="ghost"
                      className="capitalize"
                      disabled={busy('stylize') || stylize.isPending}
                      onClick={() => stylize.mutate(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </ActionRow>

                <ActionRow
                  icon={<Puzzle className="h-4 w-4" />}
                  title="Split into parts kit"
                  hint="Segments the model into named parts you can place on their own in sets and remix."
                >
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy('segment') || segment.isPending}
                    onClick={() => segment.mutate()}
                  >
                    Split into parts
                  </Button>
                </ActionRow>

                <ActionRow
                  icon={<Download className="h-4 w-4" />}
                  title="Export"
                  hint="Game engines, 3D printing, and iPhone AR."
                >
                  <Select
                    value={exportFormat}
                    onValueChange={(v) => setExportFormat(v as ExportFormat)}
                  >
                    <SelectTrigger className="h-8 w-[230px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPORT_FORMATS.map((f) => (
                        <SelectItem key={f.id} value={f.id} className="text-xs">
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy('convert') || convert.isPending}
                    onClick={() => convert.mutate()}
                  >
                    Export
                  </Button>
                </ActionRow>
              </>
            )}

            {finishedExports.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {finishedExports.slice(0, 6).map((j) => (
                  <Button key={j.id} asChild size="sm" variant="secondary" className="h-7 text-xs">
                    <a href={url(j.result?.url)} download target="_blank" rel="noreferrer">
                      <Download className="mr-1 h-3 w-3" />
                      {String(j.result?.format ?? 'file')}
                    </a>
                  </Button>
                ))}
              </div>
            )}

            {partsKits.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <Puzzle className="mr-1 inline h-3 w-3" />
                Parts kit: {(partsKits[0].result?.parts as string[] | undefined)?.join(', ')} — add
                them from the set builder's asset shelf.
              </div>
            )}

            {jobs.length > 0 && <JobList jobs={jobs} onRetried={refresh} />}

            {entity.universeAddress && (
              <Button asChild size="sm" variant="ghost" className="px-0 text-xs">
                <Link to="/universe/$id/world" params={{ id: entity.universeAddress }}>
                  <Clapperboard className="mr-1 h-3.5 w-3.5" />
                  Open the universe set builder
                </Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActionRow({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function JobList({
  jobs,
  onRetried,
  entityNames,
}: {
  jobs: TripoJob[];
  onRetried?: () => void;
  /** entityId → name, for lists spanning several entities (World tab). */
  entityNames?: Record<string, string>;
}) {
  const retry = useMutation({
    mutationFn: (jobId: string) => trpcClient.tripo.retryJob.mutate({ jobId }),
    onSuccess: () => {
      toast.success('Retrying', {
        description: 'Steps that already finished are reused — not paid for again.',
      });
      onRetried?.();
    },
    onError: (err: unknown) => {
      const e = err as { data?: { byokRequired?: boolean }; message?: string };
      if (!e?.data?.byokRequired) toast.error(e?.message ?? 'Could not retry');
    },
  });
  return (
    <div className="space-y-1.5 rounded-md border p-2">
      {jobs.slice(0, 6).map((j) => {
        const pct = jobProgress(j);
        const current = j.steps.find((s) => s.status === 'running');
        const active = j.status === 'running' || j.status === 'queued';
        return (
          <div key={j.id} className="space-y-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">
                {JOB_LABELS[j.kind] ?? j.kind}
                {j.entityId && entityNames?.[j.entityId] && (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    — {entityNames[j.entityId]}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={
                    j.status === 'failed'
                      ? 'text-destructive'
                      : j.status === 'completed'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-muted-foreground'
                  }
                >
                  {j.status === 'queued'
                    ? 'Queued'
                    : j.status === 'running'
                      ? `${current?.name ?? 'Starting'} · ${pct}%`
                      : j.status === 'failed'
                        ? 'Failed'
                        : 'Done'}
                </span>
                {j.retryable && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(j.id)}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Retry
                  </Button>
                )}
              </span>
            </div>
            {active && (
              <div className="h-1 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            )}
            {j.status === 'failed' && j.failureReason && (
              <p className="text-destructive/80 line-clamp-2">{j.failureReason}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

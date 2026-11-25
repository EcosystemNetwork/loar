/**
 * /studio/characters — Character Studio.
 *
 * Pick a universe, pick one of its wiki characters, and take it from cover
 * art to an animated 3D character: model → rig → motion library. Every
 * output is written back to the character's wiki page (entity metadata +
 * media gallery), so the studio is how a wiki character page gets built
 * out in 3D. New characters start as wiki entries (/create/person).
 */
import { useMemo, useState } from 'react';
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  Bone,
  Box,
  ExternalLink,
  Footprints,
  ImageIcon,
  Loader2,
  PersonStanding,
  Plus,
  Search,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useIsUniverseAdmin } from '@/hooks/useIsUniverseAdmin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SmartImage } from '@/components/SmartImage';
import { cn } from '@/lib/utils';
import { AnimationPicker } from '@/components/characters/AnimationPicker';
import { CharacterViewer } from '@/components/characters/CharacterViewer';
import { PUPPET_KINDS, RIG_TYPES, type Puppet, type RigType } from '@/components/characters/clips';
import { JobList } from '@/components/world/Entity3DStudio';
import {
  useEntityTripoJobs,
  useWorldOverview,
  type WorldOverviewRow,
} from '@/components/world/useTripoJob';

const searchSchema = z.object({
  universe: z.string().optional(),
  entity: z.string().optional(),
});

export const Route = createFileRoute('/studio/characters')({
  component: CharacterStudioPage,
  validateSearch: searchSchema,
});

interface UniverseOption {
  id: string;
  name?: string | null;
}

function CharacterStudioPage() {
  const { universe, entity } = useSearch({ from: '/studio/characters' });
  const navigate = useNavigate({ from: '/studio/characters' });
  const { address, isAuthenticated } = useWalletAuth();

  const { data: mine, isLoading: loadingMine } = useQuery({
    queryKey: ['studio', 'characters', 'my-universes', address],
    queryFn: async () => {
      try {
        return await trpcClient.universes.getEditableByMe.query();
      } catch {
        return await trpcClient.universes.getByCreator.query({ creator: address! });
      }
    },
    enabled: !!address && isAuthenticated,
  });
  const universes = useMemo(
    () => (((mine as any)?.data ?? mine ?? []) as UniverseOption[]).filter((u) => u?.id),
    [mine]
  );
  const universeId = universe ?? universes[0]?.id;

  const setUniverse = (id: string) => void navigate({ search: { universe: id }, replace: true });
  const setEntity = (id: string) =>
    void navigate({ search: (s) => ({ ...s, entity: id }), replace: true });

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <PersonStanding className="h-4 w-4" />
            Character Studio
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Bring your characters to life</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Turn a wiki character&apos;s art into a 3D model, rig it with a skeleton, and give it
            animations. Everything you make shows up on the character&apos;s wiki page.
          </p>
        </div>
        {universes.length > 0 && (
          <Select value={universeId} onValueChange={setUniverse}>
            <SelectTrigger className="w-[260px]" aria-label="Universe">
              <SelectValue placeholder="Pick a universe" />
            </SelectTrigger>
            <SelectContent>
              {universes.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name || `${u.id.slice(0, 10)}…`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>

      {!isAuthenticated && !universe ? (
        <EmptyState
          title="Sign in to open your characters"
          body="The studio works on the characters in universes you own or manage."
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: '/studio/characters' } as never}>
                Sign in
              </Link>
            </Button>
          }
        />
      ) : loadingMine && !universeId ? (
        <Skeleton className="h-[480px] w-full" />
      ) : !universeId ? (
        <EmptyState
          title="No universes yet"
          body="Characters live in a universe's wiki. Create a universe, add a character, then come back to build it in 3D."
          action={
            <Button asChild>
              <Link to="/cinematicUniverseCreate">Create a universe</Link>
            </Button>
          }
        />
      ) : (
        <StudioBody
          key={universeId}
          universeId={universeId}
          selectedId={entity}
          onSelect={setEntity}
        />
      )}
    </div>
  );
}

function StudioBody({
  universeId,
  selectedId,
  onSelect,
}: {
  universeId: string;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const { data: rows = [], isLoading } = useWorldOverview(universeId);
  const { isAdmin } = useIsUniverseAdmin(universeId);
  const [query, setQuery] = useState('');

  const characters = useMemo(
    () =>
      rows
        .filter((r) => PUPPET_KINDS.includes(r.kind))
        .filter((r) => !query || r.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rows, query]
  );
  const selected = characters.find((c) => c.id === selectedId) ?? characters[0] ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search characters"
              className="pl-8"
              aria-label="Search characters"
            />
          </div>
          {isAdmin && (
            <Button asChild size="icon" variant="outline" aria-label="New character">
              <Link
                to="/create/$kind"
                params={{ kind: 'person' }}
                search={{ universe: universeId }}
              >
                <Plus className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : characters.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {query ? (
              'No characters match.'
            ) : (
              <>
                This wiki has no characters yet.{' '}
                {isAdmin && (
                  <Link
                    to="/create/$kind"
                    params={{ kind: 'person' }}
                    search={{ universe: universeId }}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Add one
                  </Link>
                )}
              </>
            )}
          </div>
        ) : (
          <ul className="max-h-[70vh] space-y-1 overflow-y-auto pr-1" aria-label="Characters">
            {characters.map((c) => (
              <li key={c.id}>
                <RosterRow row={c} active={c.id === selected?.id} onClick={() => onSelect(c.id)} />
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="min-w-0">
        {selected ? (
          <Workspace key={selected.id} entityId={selected.id} isAdmin={isAdmin} />
        ) : (
          !isLoading && (
            <EmptyState
              title="Pick a character"
              body="Choose a character from the list to build it in 3D."
            />
          )
        )}
      </main>
    </div>
  );
}

function RosterRow({
  row,
  active,
  onClick,
}: {
  row: WorldOverviewRow;
  active: boolean;
  onClick: () => void;
}) {
  const clips = row.puppet?.animations.length ?? 0;
  const stage = row.puppet ? 'Animated' : row.modelUrl ? '3D' : row.imageUrl ? 'Art' : 'No art';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/50'
      )}
    >
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
        {(row.thumbnailUrl ?? row.imageUrl) && (
          <SmartImage
            src={(row.thumbnailUrl ?? row.imageUrl)!}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{row.name}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="capitalize">{row.kind}</span>
          <span aria-hidden>·</span>
          <span>{stage}</span>
          {clips > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {clips} clip{clips === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

interface EntityLike {
  id: string;
  name: string;
  kind: string;
  imageUrl?: string | null;
  creator?: string | null;
  universeAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

function Workspace({ entityId, isAdmin }: { entityId: string; isAdmin: boolean }) {
  const { address } = useWalletAuth();
  const { data: entity, isLoading } = useQuery({
    queryKey: ['entity', entityId],
    queryFn: () => trpcClient.entities.get.query({ entityId }),
  });

  if (isLoading || !entity) return <Skeleton className="h-[520px] w-full" />;
  const e = entity as unknown as EntityLike;
  const canManage = isAdmin || (!!address && e.creator?.toLowerCase() === address.toLowerCase());
  return <CharacterWorkspace entity={e} canManage={canManage} />;
}

function CharacterWorkspace({ entity, canManage }: { entity: EntityLike; canManage: boolean }) {
  const meta = (entity.metadata ?? {}) as Record<string, any>;
  const puppet = (meta.puppet ?? null) as Puppet | null;
  const modelUrl: string | null =
    puppet?.modelUrl ?? meta.model3d?.glbUrl ?? (meta.modelUrl as string | undefined) ?? null;
  const viewerModel: string | null = puppet?.modelUrl
    ? (puppet.webModelUrl ?? puppet.modelUrl)
    : meta.model3d?.glbUrl
      ? (meta.model3d.webGlbUrl ?? meta.model3d.glbUrl)
      : modelUrl;
  const posterUrl: string | null = puppet?.thumbnailUrl ?? meta.model3d?.thumbnailUrl ?? null;
  const rigged = !!puppet?.riggedModelUrl && !!puppet.rigType;
  const clips = puppet?.animations ?? [];
  const noArt = !entity.imageUrl;

  const jobsQuery = useEntityTripoJobs(entity.id, canManage);
  const jobs = jobsQuery.data ?? [];
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const busy = (...kinds: string[]) => running.some((j) => kinds.includes(j.kind));

  const [puppetRig, setPuppetRig] = useState<RigType>(
    entity.kind === 'person' ? 'biped' : 'quadruped'
  );
  const [rigType, setRigType] = useState<RigType | 'auto'>('auto');

  const started = (label: string) => {
    toast.success(`${label} started`, { description: 'Runs in the background — usually 1–5 min.' });
    void jobsQuery.refetch();
  };
  const onError = (err: unknown) => {
    // byokRequired errors open the global "add your key" modal (query-client.ts).
    const e = err as { data?: { byokRequired?: boolean }; message?: string };
    if (!e?.data?.byokRequired) toast.error(e?.message ?? 'Something went wrong');
  };

  const generate = useMutation({
    mutationFn: (quality: 'hifi' | 'game') =>
      trpcClient.tripo.entityTo3D.mutate({ entityId: entity.id, quality }),
    onSuccess: () => started('3D model'),
    onError,
  });
  const buildPuppet = useMutation({
    mutationFn: () =>
      trpcClient.tripo.characterPuppet.mutate({ entityId: entity.id, rigType: puppetRig }),
    onSuccess: () => started('Full character build'),
    onError,
  });
  const rig = useMutation({
    mutationFn: () => trpcClient.tripo.rigEntityModel.mutate({ entityId: entity.id, rigType }),
    onSuccess: () => started('Rig'),
    onError,
  });
  const animate = useMutation({
    mutationFn: (animations: string[]) =>
      trpcClient.tripo.animateCharacter.mutate({
        entityId: entity.id,
        animations: animations as Parameters<
          typeof trpcClient.tripo.animateCharacter.mutate
        >[0]['animations'],
      }),
    onSuccess: (_d, presets) =>
      started(`${presets.length} animation${presets.length === 1 ? '' : 's'}`),
    onError,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">{entity.name}</h2>
          <p className="text-sm capitalize text-muted-foreground">
            {entity.kind}
            {puppet?.rigType && ` · ${puppet.rigType} rig`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {running.length > 0 && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Loader2 className="h-3 w-3 animate-spin" />
              {running.length} building
            </Badge>
          )}
          <Button asChild size="sm" variant="outline">
            <Link to="/wiki/entity/$id" params={{ id: entity.id }}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Wiki page
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            {viewerModel ? (
              <CharacterViewer
                name={entity.name}
                modelUrl={viewerModel}
                posterUrl={posterUrl}
                usdzUrl={(meta.usdzUrl as string | undefined) ?? null}
                clips={clips}
                className="max-h-[560px]"
              />
            ) : (
              <div className="flex aspect-square max-h-[560px] w-full flex-col items-center justify-center gap-3 rounded-md bg-muted/30 text-center">
                {entity.imageUrl ? (
                  <SmartImage
                    src={entity.imageUrl}
                    alt={entity.name}
                    className="max-h-[70%] max-w-[70%] rounded-md object-contain"
                  />
                ) : (
                  <ImageIcon className="h-10 w-10 text-muted-foreground" />
                )}
                <p className="px-6 text-sm text-muted-foreground">
                  {noArt
                    ? 'No cover art yet — 3D is generated from it.'
                    : 'No 3D model yet. Generate one from this art.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Step
            n={1}
            icon={<ImageIcon className="h-4 w-4" />}
            title="Cover art"
            done={!noArt}
            hint={
              noArt
                ? 'Add art on the wiki page: upload or generate a full-body portrait.'
                : 'Full-body, plain-background art rigs best.'
            }
          >
            {noArt && (
              <Button asChild size="sm" variant="outline">
                <Link to="/wiki/entity/$id" params={{ id: entity.id }}>
                  <Wand2 className="mr-1 h-3.5 w-3.5" />
                  Add art on the wiki
                </Link>
              </Button>
            )}
          </Step>

          <Step
            n={2}
            icon={<Box className="h-4 w-4" />}
            title="3D model"
            done={!!modelUrl}
            hint="The full build poses the art, makes a turnaround sheet, then a body, rig and starter clips. The turnaround also keeps this character on-model in videos."
          >
            {canManage && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={puppetRig} onValueChange={(v) => setPuppetRig(v as RigType)}>
                    <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Skeleton type">
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
                    <Footprints className="mr-1 h-3.5 w-3.5" />
                    {puppet?.riggedModelUrl ? 'Rebuild character' : 'Full build'}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Model only:</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={noArt || busy('entity_model') || generate.isPending}
                    onClick={() => generate.mutate('hifi')}
                  >
                    <Sparkles className="mr-1 h-3.5 w-3.5" />
                    High detail
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={noArt || busy('entity_model') || generate.isPending}
                    onClick={() => generate.mutate('game')}
                  >
                    Game-ready
                  </Button>
                </div>
              </>
            )}
          </Step>

          <Step
            n={3}
            icon={<Bone className="h-4 w-4" />}
            title="Rig"
            done={rigged}
            hint={
              modelUrl
                ? 'Adds a skeleton to the current model without rebuilding it. Auto-detect picks humanoid, quadruped, spider, snake and so on.'
                : 'Needs a 3D model first.'
            }
          >
            {canManage && modelUrl && (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={rigType} onValueChange={(v) => setRigType(v as RigType | 'auto')}>
                  <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Rig type">
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
                  variant={rigged ? 'outline' : 'default'}
                  disabled={busy('rig_model', 'character_puppet') || rig.isPending}
                  onClick={() => rig.mutate()}
                >
                  {rigged ? 'Re-rig' : 'Rig model'}
                </Button>
              </div>
            )}
          </Step>

          <Step
            n={4}
            icon={<Footprints className="h-4 w-4" />}
            title="Animations"
            done={clips.length > 0}
            hint={
              rigged
                ? `${clips.length} in the motion library. Add up to 10 at a time; they merge into the library.`
                : 'Rig the character first; animations play on its skeleton.'
            }
          >
            {canManage && rigged && (
              <AnimationPicker
                rigType={puppet!.rigType as RigType}
                owned={clips.map((c) => c.preset)}
                busy={busy('animate_model', 'rig_model', 'character_puppet') || animate.isPending}
                onAdd={(presets) => animate.mutate(presets)}
              />
            )}
          </Step>

          {!canManage && (
            <p className="text-xs text-muted-foreground">
              Only this character&apos;s creator or a universe manager can build it.
            </p>
          )}
        </div>
      </div>

      {puppet?.turnaround && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <PersonStanding className="h-4 w-4" />
            Turnaround
            <span className="text-xs font-normal text-muted-foreground">
              (character references for image and video generation)
            </span>
          </h3>
          <div className="grid grid-cols-4 gap-2 sm:max-w-xl">
            {(['front', 'left', 'back', 'right'] as const).map((v) =>
              puppet.turnaround?.[v] ? (
                <figure key={v} className="space-y-1">
                  <SmartImage
                    src={puppet.turnaround[v]!}
                    alt={`${entity.name}, ${v} view`}
                    className="aspect-square w-full rounded-md border bg-muted/30 object-contain"
                  />
                  <figcaption className="text-center text-[11px] capitalize text-muted-foreground">
                    {v}
                  </figcaption>
                </figure>
              ) : null
            )}
          </div>
        </section>
      )}

      {canManage && jobs.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Recent jobs</h3>
          <JobList jobs={jobs} onRetried={() => void jobsQuery.refetch()} />
        </section>
      )}
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  hint,
  done,
  children,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  hint: string;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums',
            done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}
          aria-label={done ? `Step ${n}, done` : `Step ${n}`}
        >
          {n}
        </span>
        {icon}
        {title}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {children && <div className="space-y-2">{children}</div>}
    </section>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <PersonStanding className="h-8 w-8 text-muted-foreground" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

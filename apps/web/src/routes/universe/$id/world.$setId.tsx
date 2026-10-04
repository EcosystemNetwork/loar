/**
 * /universe/$id/world/$setId — set builder (#4) + explorable diorama (#7).
 *
 * Edit (universe managers): drop canon assets from the shelf into a splat
 * environment, arrange them, save camera angles, capture shots, and send a
 * shot to /create as a video's start frame.
 * Explore (everyone, once published): walk the set as its player puppet;
 * linked props open their episode or wiki page.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Box,
  Camera,
  Eye,
  Footprints,
  Loader2,
  Map as MapIcon,
  Move3d,
  Pencil,
  Puzzle,
  RotateCw,
  Save,
  Scaling,
  Trash2,
  Video,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { uploadFile } from '@/lib/upload-file';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SmartImage } from '@/components/SmartImage';
import { useWorldOverview } from '@/components/world/useTripoJob';
import type {
  SceneApi,
  SetCamera,
  SetEnvironment,
  SetObject,
  SetShot,
  Vec3,
} from '@/components/world/scene/types';
import type { TransformMode } from '@/components/world/scene/WorldScene';

// three.js + R3F + Spark only load on this route.
const WorldScene = lazy(() =>
  import('@/components/world/scene/WorldScene').then((m) => ({ default: m.WorldScene }))
);

const searchSchema = z.object({ mode: z.enum(['edit', 'explore']).optional() });

export const Route = createFileRoute('/universe/$id/world/$setId')({
  component: SetPage,
  validateSearch: searchSchema,
});

const shortId = () => crypto.randomUUID().slice(0, 8);

interface Draft {
  name: string;
  environment: SetEnvironment | null;
  objects: SetObject[];
  cameras: SetCamera[];
  shots: SetShot[];
  spawn: Vec3;
  published: boolean;
}

function SetPage() {
  const { id: universeId, setId } = useParams({ from: '/universe/$id/world/$setId' });
  const search = useSearch({ from: '/universe/$id/world/$setId' });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['worldSet', setId],
    queryFn: () => trpcClient.worldSets.get.query({ setId }),
  });
  const canEdit = !!data?.canEdit;
  const mode = search.mode ?? (canEdit ? 'edit' : 'explore');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (data?.set && !draft) {
      const s = data.set;
      setDraft({
        name: s.name,
        environment: s.environment,
        objects: s.objects,
        cameras: s.cameras,
        shots: s.shots,
        spawn: s.spawn,
        published: s.published,
      });
    }
  }, [data, draft]);

  const edit = (fn: (d: Draft) => Draft) => {
    setDraft((d) => (d ? fn(d) : d));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => trpcClient.worldSets.update.mutate({ setId, patch: draft! }),
    onSuccess: () => {
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['worldSets', universeId] });
      toast.success('Set saved');
    },
    onError: (err: any) => toast.error(err?.message ?? 'Save failed'),
  });

  // Warn before losing unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const setMode = (m: 'edit' | 'explore') =>
    navigate({ to: '.', search: { mode: m }, replace: true });

  const onLink = (link: NonNullable<SetObject['link']>) => {
    if (link.kind === 'episode') navigate({ to: '/episode/$id', params: { id: link.target } });
    else if (link.kind === 'entity')
      navigate({ to: '/wiki/entity/$id', params: { id: link.target } });
    else if (/^https?:\/\//.test(link.target)) window.open(link.target, '_blank', 'noopener');
  };

  if (isLoading || (data && !draft)) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (error || !data || !draft) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-muted-foreground">
        Set not found.{' '}
        <Link
          to="/universe/$id/world"
          params={{ id: universeId }}
          className="text-primary underline"
        >
          Back to world
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Link to="/universe/$id/world" params={{ id: universeId }}>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Back to world">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        {canEdit && mode === 'edit' ? (
          <Input
            value={draft.name}
            onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
            className="h-8 w-[220px] font-medium"
            maxLength={120}
            aria-label="Set name"
          />
        ) : (
          <h1 className="font-semibold">{draft.name}</h1>
        )}
        {!draft.published && <Badge variant="outline">Draft</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={draft.published}
                  onCheckedChange={(v) => edit((d) => ({ ...d, published: v === true }))}
                />
                Published
              </label>
              <Button
                size="sm"
                variant={mode === 'edit' ? 'outline' : 'default'}
                onClick={() => setMode(mode === 'edit' ? 'explore' : 'edit')}
              >
                {mode === 'edit' ? (
                  <>
                    <Eye className="mr-1 h-3.5 w-3.5" /> Explore
                  </>
                ) : (
                  <>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </>
                )}
              </Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                {save.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1 h-3.5 w-3.5" />
                )}
                {dirty ? 'Save' : 'Saved'}
              </Button>
            </>
          )}
        </div>
      </div>

      {mode === 'edit' && canEdit ? (
        <SetEditor
          universeId={universeId}
          draft={draft}
          edit={edit}
          onLink={onLink}
          onMakeVideo={(shot) =>
            navigate({
              to: '/create',
              search: {
                universe: universeId,
                mode: 'video',
                image: shot.imageUrl,
                prompt: `${draft.name}: `,
              },
            })
          }
        />
      ) : (
        <div className="relative min-h-0 flex-1">
          <Suspense fallback={<SceneLoading />}>
            <WorldScene
              mode="explore"
              environment={draft.environment}
              objects={draft.objects}
              spawn={draft.spawn}
              onLink={onLink}
              className="h-full w-full"
            />
          </Suspense>
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-background/80 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur">
            W/S move · A/D turn · Shift run · E interact
          </div>
        </div>
      )}
    </div>
  );
}

function SceneLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading 3D…
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────

function SetEditor({
  universeId,
  draft,
  edit,
  onLink,
  onMakeVideo,
}: {
  universeId: string;
  draft: Draft;
  edit: (fn: (d: Draft) => Draft) => void;
  onLink: (link: NonNullable<SetObject['link']>) => void;
  onMakeVideo: (shot: SetShot) => void;
}) {
  const apiRef = useRef<SceneApi | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const [capturing, setCapturing] = useState(false);
  const selected = draft.objects.find((o) => o.id === selectedId) ?? null;

  const updateObject = (id: string, patch: Partial<SetObject>) =>
    edit((d) => ({ ...d, objects: d.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));

  const addObject = (o: Omit<SetObject, 'id' | 'position' | 'rotationY' | 'scale'>) => {
    const id = shortId();
    // Fan new objects out in front of the camera target so they don't stack.
    const n = draft.objects.length;
    const position: Vec3 = [((n % 5) - 2) * 1.5, 0, Math.floor(n / 5) * -1.5];
    edit((d) => ({
      ...d,
      objects: [...d.objects, { ...o, id, position, rotationY: 0, scale: 1 }],
    }));
    setSelectedId(id);
  };

  const saveCamera = () => {
    const view = apiRef.current?.getView();
    if (!view) return;
    edit((d) => ({
      ...d,
      cameras: [...d.cameras, { id: shortId(), name: `Angle ${d.cameras.length + 1}`, ...view }],
    }));
  };

  const captureShot = async () => {
    if (!apiRef.current) return;
    setCapturing(true);
    try {
      const blob = await apiRef.current.capture();
      const manifest = await uploadFile(
        new File([blob], `${draft.name}-shot.png`, { type: 'image/png' })
      );
      const url = manifest.uploads[0]?.url;
      if (!url) throw new Error('Upload returned no URL');
      edit((d) => ({
        ...d,
        shots: [
          { id: shortId(), cameraId: null, imageUrl: url, createdAt: new Date().toISOString() },
          ...d.shots,
        ].slice(0, 48),
      }));
      toast.success('Shot captured', {
        description: 'Use it as a video start frame from the Shots list.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Capture failed');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(320px,1fr)_auto] lg:grid-cols-[260px_1fr_300px] lg:grid-rows-1">
      <AssetShelf
        universeId={universeId}
        onAdd={addObject}
        onEnvironment={(env) => edit((d) => ({ ...d, environment: env }))}
        className="order-2 border-t lg:order-1 lg:border-r lg:border-t-0"
      />

      <div className="relative order-1 min-h-0 lg:order-2">
        <Suspense fallback={<SceneLoading />}>
          <WorldScene
            mode="edit"
            environment={draft.environment}
            objects={draft.objects}
            spawn={draft.spawn}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onTransform={(id, t) => updateObject(id, t)}
            transformMode={transformMode}
            apiRef={apiRef}
            onLink={onLink}
            className="h-full w-full"
          />
        </Suspense>
        <div className="absolute left-2 top-2 flex gap-1 rounded-md bg-background/80 p-1 backdrop-blur">
          {(
            [
              ['translate', Move3d, 'Move'],
              ['rotate', RotateCw, 'Rotate'],
              ['scale', Scaling, 'Scale'],
            ] as const
          ).map(([m, Icon, label]) => (
            <Button
              key={m}
              size="icon"
              variant={transformMode === m ? 'default' : 'ghost'}
              className="h-7 w-7"
              onClick={() => setTransformMode(m)}
              title={label}
              aria-label={label}
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
        <div className="absolute right-2 top-2 flex gap-1">
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={saveCamera}>
            <Camera className="mr-1 h-3.5 w-3.5" />
            Save angle
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={captureShot} disabled={capturing}>
            {capturing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Video className="mr-1 h-3.5 w-3.5" />
            )}
            Capture shot
          </Button>
        </div>
      </div>

      <div className="order-3 space-y-5 overflow-y-auto border-t p-3 text-sm lg:border-l lg:border-t-0">
        {selected ? (
          <ObjectInspector
            object={selected}
            onChange={(p) => updateObject(selected.id, p)}
            onPlayer={(v) =>
              edit((d) => ({
                ...d,
                objects: d.objects.map((o) => ({
                  ...o,
                  isPlayer: o.id === selected.id ? v : false,
                })),
              }))
            }
            onDelete={() => {
              edit((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== selected.id) }));
              setSelectedId(null);
            }}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Add assets from the shelf, click one to select it, then drag the gizmo. Save camera
            angles and capture shots to turn this set into video.
          </p>
        )}

        {draft.environment && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MapIcon className="h-3.5 w-3.5" /> Environment
            </h3>
            <NumberField
              label="Scale"
              value={draft.environment.scale}
              step={0.1}
              min={0.01}
              onChange={(v) =>
                edit((d) => ({
                  ...d,
                  environment: d.environment && { ...d.environment, scale: v },
                }))
              }
            />
            <NumberField
              label="Height"
              value={draft.environment.position[1]}
              step={0.1}
              onChange={(v) =>
                edit((d) => ({
                  ...d,
                  environment: d.environment && {
                    ...d.environment,
                    position: [d.environment.position[0], v, d.environment.position[2]],
                  },
                }))
              }
            />
            <NumberField
              label="Rotation°"
              value={Math.round((draft.environment.rotationY * 180) / Math.PI)}
              step={5}
              onChange={(v) =>
                edit((d) => ({
                  ...d,
                  environment: d.environment && {
                    ...d.environment,
                    rotationY: (v * Math.PI) / 180,
                  },
                }))
              }
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-destructive"
              onClick={() => edit((d) => ({ ...d, environment: null }))}
            >
              Remove environment
            </Button>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Camera className="h-3.5 w-3.5" /> Camera angles
          </h3>
          {draft.cameras.length === 0 && (
            <p className="text-xs text-muted-foreground">None saved yet.</p>
          )}
          {draft.cameras.map((c) => (
            <div key={c.id} className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 flex-1 justify-start text-xs"
                onClick={() => apiRef.current?.setView(c as never)}
              >
                {c.name}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={`Delete ${c.name}`}
                onClick={() =>
                  edit((d) => ({ ...d, cameras: d.cameras.filter((x) => x.id !== c.id) }))
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Video className="h-3.5 w-3.5" /> Shots
          </h3>
          {draft.shots.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Capture a shot to use it as a video's first frame.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {draft.shots.map((s) => (
              <div key={s.id} className="group relative overflow-hidden rounded border">
                <SmartImage
                  src={s.imageUrl}
                  alt="Set shot"
                  className="aspect-video w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-background/85 p-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                  <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => onMakeVideo(s)}>
                    Make video
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    aria-label="Delete shot"
                    onClick={() =>
                      edit((d) => ({ ...d, shots: d.shots.filter((x) => x.id !== s.id) }))
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        value={Number(value.toFixed(3))}
        step={step}
        min={min}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v) && (min === undefined || v >= min)) onChange(v);
        }}
        className="h-7 w-24 text-xs"
      />
    </label>
  );
}

function ObjectInspector({
  object,
  onChange,
  onPlayer,
  onDelete,
}: {
  object: SetObject;
  onChange: (p: Partial<SetObject>) => void;
  onPlayer: (v: boolean) => void;
  onDelete: () => void;
}) {
  const link = object.link ?? null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Selected
      </h3>
      <Input
        value={object.label}
        onChange={(e) => onChange({ label: e.target.value })}
        className="h-8 text-sm"
        maxLength={120}
        aria-label="Object label"
      />
      {object.partName && (
        <p className="text-xs text-muted-foreground">
          <Puzzle className="mr-1 inline h-3 w-3" />
          Part: {object.partName}
        </p>
      )}
      <NumberField
        label="Scale"
        value={object.scale}
        step={0.1}
        min={0.01}
        onChange={(v) => onChange({ scale: v })}
      />
      <NumberField
        label="Rotation°"
        value={Math.round((object.rotationY * 180) / Math.PI)}
        step={15}
        onChange={(v) => onChange({ rotationY: (v * Math.PI) / 180 })}
      />
      {!!object.animations?.length && (
        <label className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Footprints className="h-3.5 w-3.5" /> Player in explore mode
          </span>
          <Checkbox checked={!!object.isPlayer} onCheckedChange={(v) => onPlayer(v === true)} />
        </label>
      )}
      <div className="space-y-1.5 rounded-md border p-2">
        <div className="text-xs text-muted-foreground">Explore link</div>
        <Select
          value={link?.kind ?? 'none'}
          onValueChange={(v) =>
            onChange({
              link:
                v === 'none'
                  ? null
                  : {
                      kind: v as 'episode' | 'entity' | 'url',
                      target: link?.target ?? '',
                      label: link?.label,
                    },
            })
          }
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs">
              None
            </SelectItem>
            <SelectItem value="episode" className="text-xs">
              Episode id
            </SelectItem>
            <SelectItem value="entity" className="text-xs">
              Wiki entity id
            </SelectItem>
            <SelectItem value="url" className="text-xs">
              URL
            </SelectItem>
          </SelectContent>
        </Select>
        {link && (
          <>
            <Input
              value={link.target}
              onChange={(e) => onChange({ link: { ...link, target: e.target.value } })}
              placeholder={link.kind === 'url' ? 'https://…' : 'id'}
              className="h-7 text-xs"
            />
            <Input
              value={link.label ?? ''}
              onChange={(e) => onChange({ link: { ...link, label: e.target.value } })}
              placeholder="Label (optional)"
              className="h-7 text-xs"
              maxLength={120}
            />
          </>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove from set
      </Button>
    </section>
  );
}

// ── Asset shelf ──────────────────────────────────────────────────────────

function AssetShelf({
  universeId,
  onAdd,
  onEnvironment,
  className,
}: {
  universeId: string;
  onAdd: (o: Omit<SetObject, 'id' | 'position' | 'rotationY' | 'scale'>) => void;
  onEnvironment: (env: SetEnvironment) => void;
  className?: string;
}) {
  const { data: rows = [] } = useWorldOverview(universeId);
  const { data: jobs = [] } = useQuery({
    queryKey: ['tripo', 'jobs', 'universe', universeId],
    queryFn: () => trpcClient.tripo.listJobs.query({ universeId, limit: 50 }),
  });
  const kits = useMemo(
    () =>
      jobs.filter(
        (j) => j.kind === 'segment' && j.status === 'completed' && j.result?.partsModelUrl
      ),
    [jobs]
  );
  const models = rows.filter((r) => r.modelUrl);
  const envs = rows.filter((r) => r.environment);

  return (
    <div className={`min-h-0 space-y-4 overflow-y-auto p-3 ${className ?? ''}`}>
      {envs.length > 0 && (
        <ShelfSection title="Environments" icon={<MapIcon className="h-3.5 w-3.5" />}>
          {envs.map((r) => (
            <ShelfItem
              key={r.id}
              label={r.name}
              image={r.imageUrl}
              onClick={() =>
                onEnvironment({
                  entityId: r.id,
                  splatUrl: r.environment!.splatUrl,
                  format: r.environment!.format,
                  position: [0, 0, 0],
                  rotationY: 0,
                  scale: 1,
                })
              }
            />
          ))}
        </ShelfSection>
      )}
      <ShelfSection title="Characters & props" icon={<Box className="h-3.5 w-3.5" />}>
        {models.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No 3D yet — generate models from wiki entities on the World page.
          </p>
        )}
        {models.map((r) => (
          <ShelfItem
            key={r.id}
            label={r.name}
            image={r.thumbnailUrl ?? r.imageUrl}
            badge={r.puppet ? 'Puppet' : undefined}
            onClick={() =>
              onAdd({
                label: r.name,
                entityId: r.id,
                // Web copies (meshopt, ~20x smaller) keep sets with many props fast.
                url: r.puppet
                  ? (r.puppet.webRiggedModelUrl ?? r.puppet.riggedModelUrl)
                  : (r.webModelUrl ?? r.modelUrl!),
                animations: r.puppet?.animations.map((a) => ({
                  name: a.name,
                  url: a.webUrl ?? a.url,
                })),
                link: { kind: 'entity', target: r.id, label: r.name },
              })
            }
          />
        ))}
      </ShelfSection>
      {kits.length > 0 && (
        <ShelfSection title="Parts kits" icon={<Puzzle className="h-3.5 w-3.5" />}>
          {kits.map((k) =>
            ((k.result?.parts as string[] | undefined) ?? []).map((part) => (
              <ShelfItem
                key={`${k.id}:${part}`}
                label={part.replace(/_/g, ' ')}
                onClick={() =>
                  onAdd({
                    label: part,
                    entityId: k.entityId,
                    url: (k.result!.webPartsModelUrl ?? k.result!.partsModelUrl) as string,
                    partName: part,
                  })
                }
              />
            ))
          )}
        </ShelfSection>
      )}
    </div>
  );
}

function ShelfSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function ShelfItem({
  label,
  image,
  badge,
  onClick,
}: {
  label: string;
  image?: string | null;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md border p-1.5 text-left text-xs hover:bg-muted/50"
    >
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-muted">
        {image && <SmartImage src={image} alt="" className="h-full w-full object-cover" />}
      </div>
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
          {badge}
        </Badge>
      )}
    </button>
  );
}

/**
 * WorldHub — a universe's 3D world at a glance: which canon entities exist
 * in 3D, the sets built from them, and bulk actions (generate missing
 * models, download the asset pack). Rendered on the wiki World tab and at
 * /universe/$id/world.
 */
import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Box,
  Clapperboard,
  Download,
  Footprints,
  Loader2,
  Map as MapIcon,
  Plus,
  Sparkles,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SmartImage } from '@/components/SmartImage';
import { Model3DThumbnail } from '@/components/Model3DThumbnailLazy';
import { useIsUniverseAdmin } from '@/hooks/useIsUniverseAdmin';
import { ENVIRONMENT_KINDS, MODELABLE_KINDS } from './Entity3DStudio';
import { buildAssetPack } from './assetPack';
import { useWorldOverview, worldOverviewKey } from './useTripoJob';

export function WorldHub({
  universeId,
  universeName,
}: {
  universeId: string;
  universeName?: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin: isManager } = useIsUniverseAdmin(universeId as `0x${string}`);
  const { data: rows = [], isLoading } = useWorldOverview(universeId);
  const { data: sets = [] } = useQuery({
    queryKey: ['worldSets', universeId],
    queryFn: () => trpcClient.worldSets.list.query({ universeId }),
  });
  const [newSetName, setNewSetName] = useState('');
  const [packProgress, setPackProgress] = useState<string | null>(null);

  const modelable = rows.filter((r) => MODELABLE_KINDS.includes(r.kind));
  const places = rows.filter((r) => ENVIRONMENT_KINDS.includes(r.kind));
  const withModel = modelable.filter((r) => r.modelUrl);
  const missing = modelable.filter((r) => !r.modelUrl && r.imageUrl);
  const puppets = rows.filter((r) => r.puppet);
  const environments = places.filter((r) => r.environment);

  const batch = useMutation({
    mutationFn: () => trpcClient.tripo.batchEntityTo3D.mutate({ universeId, limit: 5 }),
    onSuccess: (r) => {
      toast.success(`Generating ${r.jobs.length} models`, {
        description: r.remaining
          ? `${r.remaining} more still need models — run again after these finish.`
          : 'Each takes a few minutes; they appear here as they land.',
      });
      setTimeout(() => qc.invalidateQueries({ queryKey: worldOverviewKey(universeId) }), 60_000);
    },
    onError: (err: any) => {
      if (!err?.data?.byokRequired) toast.error(err?.message ?? 'Could not start generation');
    },
  });

  const createSet = useMutation({
    mutationFn: (env: (typeof environments)[number] | null) =>
      trpcClient.worldSets.create.mutate({
        universeId,
        name: newSetName.trim() || (env ? `${env.name} set` : 'New set'),
        environment: env?.environment
          ? {
              entityId: env.id,
              splatUrl: env.environment.splatUrl,
              format: env.environment.format,
              position: [0, 0, 0],
              rotationY: 0,
              scale: 1,
            }
          : null,
      }),
    onSuccess: ({ setId }) =>
      navigate({ to: '/universe/$id/world/$setId', params: { id: universeId, setId } }),
    onError: (err: any) => toast.error(err?.message ?? 'Could not create set'),
  });

  const downloadPack = async () => {
    setPackProgress('Preparing…');
    try {
      const { blob, filename, skipped } = await buildAssetPack(
        universeName ?? 'universe',
        rows,
        (d, t) => setPackProgress(`Downloading ${d}/${t}`)
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      if (skipped.length)
        toast.warning(`${skipped.length} files could not be fetched — see manifest.json`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Asset pack failed');
    } finally {
      setPackProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Coverage */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={<Box className="h-4 w-4" />}
          label="3D models"
          value={`${withModel.length}/${modelable.length}`}
        />
        <Stat
          icon={<Footprints className="h-4 w-4" />}
          label="Puppets"
          value={String(puppets.length)}
        />
        <Stat
          icon={<MapIcon className="h-4 w-4" />}
          label="Environments"
          value={`${environments.length}/${places.length}`}
        />
        <Stat
          icon={<Clapperboard className="h-4 w-4" />}
          label="Sets"
          value={String(sets.length)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {isManager && missing.length > 0 && (
          <Button size="sm" onClick={() => batch.mutate()} disabled={batch.isPending}>
            {batch.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" />
            )}
            Generate missing models ({missing.length})
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={downloadPack}
          disabled={!!packProgress || rows.every((r) => !r.modelUrl && !r.puppet && !r.environment)}
        >
          {packProgress ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1 h-3.5 w-3.5" />
          )}
          {packProgress ?? 'Download asset pack'}
        </Button>
      </div>

      {/* Sets */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clapperboard className="h-4 w-4" />
            Sets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sets.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {isManager
                ? 'Stage your characters and props in a 3D set, frame shots, and turn them into video — or publish it for fans to walk through.'
                : 'No sets published yet.'}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {sets.map((s) => (
              <Link
                key={s.id}
                to="/universe/$id/world/$setId"
                params={{ id: universeId, setId: s.id }}
                className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/40"
              >
                <div>
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.objects.length} objects · {s.shots.length} shots
                  </div>
                </div>
                {!s.published && <Badge variant="outline">Draft</Badge>}
              </Link>
            ))}
          </div>
          {isManager && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Input
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder="Set name"
                className="h-8 w-[200px] text-sm"
                maxLength={120}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => createSet.mutate(null)}
                disabled={createSet.isPending}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Empty set
              </Button>
              {environments.map((env) => (
                <Button
                  key={env.id}
                  size="sm"
                  variant="outline"
                  onClick={() => createSet.mutate(env)}
                  disabled={createSet.isPending}
                >
                  <MapIcon className="mr-1 h-3.5 w-3.5" />
                  In {env.name}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Canon in 3D */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Canon in 3D</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No characters, things or places in this wiki yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {rows.map((r) => (
              <Link
                key={r.id}
                to="/wiki/entity/$id"
                params={{ id: r.id }}
                className="group overflow-hidden rounded-lg border hover:border-primary/50"
              >
                <div className="aspect-square bg-muted/30">
                  {r.thumbnailUrl ? (
                    <SmartImage
                      src={r.thumbnailUrl}
                      alt={r.name}
                      className="h-full w-full object-contain"
                    />
                  ) : r.modelUrl ? (
                    <Model3DThumbnail
                      src={r.modelUrl}
                      alt={r.name}
                      className="h-full w-full"
                      fallback={<Box className="m-auto h-8 w-8 text-muted-foreground" />}
                    />
                  ) : r.imageUrl ? (
                    <SmartImage
                      src={r.imageUrl}
                      alt={r.name}
                      className="h-full w-full object-cover opacity-60 group-hover:opacity-80"
                    />
                  ) : null}
                </div>
                <div className="space-y-1 p-2">
                  <div className="truncate text-xs font-medium">{r.name}</div>
                  <div className="flex flex-wrap gap-1">
                    {r.modelUrl && (
                      <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                        3D
                      </Badge>
                    )}
                    {r.puppet && (
                      <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                        Puppet
                      </Badge>
                    )}
                    {r.environment && (
                      <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                        Env
                      </Badge>
                    )}
                    {!r.modelUrl && !r.environment && (
                      <Badge
                        variant="outline"
                        className="h-4 px-1 text-[10px] text-muted-foreground"
                      >
                        2D only
                      </Badge>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Shown on the wiki 3D World tab when no universe is selected yet. */
export function WorldUniversePicker({
  universes,
  onSelect,
}: {
  universes: Array<{ id: string; name?: string; image_url?: string }>;
  onSelect: (universeId: string) => void;
}) {
  const named = universes.filter((u) => !!u.name);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Pick a universe to open its 3D world</h2>
        <p className="text-sm text-muted-foreground">
          See its characters, props and places in 3D, build sets, and walk through them.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {named.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => onSelect(u.id)}
            className="group overflow-hidden rounded-lg border text-left hover:border-primary/50"
          >
            <div className="aspect-video bg-muted/30">
              {u.image_url && (
                <SmartImage
                  src={u.image_url}
                  alt={u.name ?? ''}
                  className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                />
              )}
            </div>
            <div className="truncate p-2 text-sm font-medium">{u.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

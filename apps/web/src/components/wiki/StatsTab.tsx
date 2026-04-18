import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card } from '@/components/ui/card';
import {
  BarChart3,
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
import type { EntityKind, WikiEntity } from './types';

interface StatsTabProps {
  universeAddress?: string;
}

const CREATOR_KINDS: {
  kind: EntityKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}[] = [
  { kind: 'person', label: 'People', icon: Users, color: 'bg-violet-500' },
  { kind: 'place', label: 'Places', icon: MapPin, color: 'bg-emerald-500' },
  { kind: 'thing', label: 'Things', icon: Package, color: 'bg-amber-500' },
  { kind: 'faction', label: 'Factions', icon: Swords, color: 'bg-rose-500' },
  { kind: 'event', label: 'Events', icon: Zap, color: 'bg-yellow-500' },
  { kind: 'lore', label: 'Lore', icon: BookOpen, color: 'bg-blue-500' },
  { kind: 'species', label: 'Species', icon: Dna, color: 'bg-cyan-500' },
  { kind: 'vehicle', label: 'Vehicles', icon: Layers, color: 'bg-orange-500' },
  { kind: 'technology', label: 'Tech', icon: Cpu, color: 'bg-lime-500' },
  { kind: 'organization', label: 'Orgs', icon: Building2, color: 'bg-pink-500' },
];

export function StatsTab({ universeAddress }: StatsTabProps) {
  const queries = useQueries({
    queries: CREATOR_KINDS.map(({ kind }) => ({
      queryKey: universeAddress
        ? ['entities', 'list', universeAddress, kind]
        : ['entities', 'listByKind', kind],
      queryFn: () =>
        universeAddress
          ? trpcClient.entities.list.query({ universeAddress, kind })
          : trpcClient.entities.listByKind.query({ kind }),
      staleTime: 60_000,
    })),
  });

  const counts = queries.map((q, i) => ({
    ...CREATOR_KINDS[i],
    count: ((q.data as { entities?: WikiEntity[] } | undefined)?.entities ?? []).length,
    entities: ((q.data as { entities?: WikiEntity[] } | undefined)?.entities ?? []) as WikiEntity[],
  }));

  const total = counts.reduce((acc, c) => acc + c.count, 0);
  const max = Math.max(1, ...counts.map((c) => c.count));

  const allEntities = useMemo(() => counts.flatMap((c) => c.entities), [counts]);

  const monetized = allEntities.filter((e) => e.monetized).length;
  const original = allEntities.filter((e) => e.rightsDeclaration === 'original').length;
  const licensed = allEntities.filter((e) => e.rightsDeclaration === 'licensed').length;
  const fan = total - original - licensed;

  const isLoading = queries.some((q) => q.isLoading);

  return (
    <div className="space-y-6">
      {isLoading && <div className="text-center py-4 text-muted-foreground">Loading stats…</div>}

      {/* Top tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <BarChart3 className="h-3.5 w-3.5" />
            Total entities
          </div>
          <p className="text-3xl font-bold">{total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Monetized</p>
          <p className="text-3xl font-bold">{monetized}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {total > 0 ? Math.round((monetized / total) * 100) : 0}% of catalog
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Creator-owned</p>
          <p className="text-3xl font-bold">{original}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Licensed</p>
          <p className="text-3xl font-bold">{licensed}</p>
        </Card>
      </div>

      {/* Rights breakdown */}
      <Card className="p-4">
        <p className="text-xs font-medium mb-3">Rights breakdown</p>
        <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted">
          <div
            className="bg-amber-500"
            style={{ width: `${total ? (fan / total) * 100 : 0}%` }}
            title={`Fan / non-commercial: ${fan}`}
          />
          <div
            className="bg-blue-600"
            style={{ width: `${total ? (original / total) * 100 : 0}%` }}
            title={`Creator-owned: ${original}`}
          />
          <div
            className="bg-green-600"
            style={{ width: `${total ? (licensed / total) * 100 : 0}%` }}
            title={`Licensed: ${licensed}`}
          />
        </div>
        <div className="flex gap-4 text-[10px] text-muted-foreground mt-2 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-amber-500" /> Fan / non-commercial ({fan})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-blue-600" /> Creator-owned ({original})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-green-600" /> Licensed ({licensed})
          </span>
        </div>
      </Card>

      {/* Per-kind bars */}
      <Card className="p-4">
        <p className="text-xs font-medium mb-3">Entities by kind</p>
        <div className="space-y-2.5">
          {counts.map(({ kind, label, icon: Icon, color, count }) => (
            <div key={kind} className="flex items-center gap-3">
              <div className="w-24 flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </div>
              <div className="flex-1 h-5 bg-muted rounded relative overflow-hidden">
                <div
                  className={`h-full ${color} transition-all`}
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </div>
              <div className="w-10 text-right text-xs font-mono">{count}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

import { useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import ReactFlow, { Background, Controls, type Edge, type Node, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import { GitBranch } from 'lucide-react';
import type { EntityKind, WikiEntity } from './types';

interface RelationshipGraphTabProps {
  universeAddress?: string;
}

const KINDS: EntityKind[] = [
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
];

const KIND_COLORS: Record<string, string> = {
  person: '#a78bfa',
  place: '#34d399',
  thing: '#fbbf24',
  faction: '#f87171',
  event: '#facc15',
  lore: '#60a5fa',
  species: '#22d3ee',
  vehicle: '#fb923c',
  technology: '#a3e635',
  organization: '#f472b6',
};

interface RelationRecord {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  description?: string;
}

export function RelationshipGraphTab({ universeAddress }: RelationshipGraphTabProps) {
  const relationsQuery = useQuery({
    queryKey: ['wiki', 'graph', 'relations', universeAddress ?? ''],
    queryFn: () =>
      trpcClient.entities.universeRelations.query({ universeAddress: universeAddress! }),
    enabled: !!universeAddress,
  });

  const entityQueries = useQueries({
    queries: KINDS.map((kind) => ({
      queryKey: ['entities', 'list', universeAddress ?? '', kind],
      queryFn: () => trpcClient.entities.list.query({ universeAddress: universeAddress!, kind }),
      enabled: !!universeAddress,
      staleTime: 30_000,
    })),
  });

  const isLoading = relationsQuery.isLoading || entityQueries.some((q) => q.isLoading);
  const entities: WikiEntity[] = entityQueries.flatMap(
    (q) => (q.data as { entities?: WikiEntity[] } | undefined)?.entities ?? []
  );
  const relations =
    (relationsQuery.data as { relations?: RelationRecord[] } | undefined)?.relations ?? [];

  const { nodes, edges } = useMemo(() => {
    if (!entities.length) return { nodes: [] as Node[], edges: [] as Edge[] };
    const radius = Math.max(180, Math.min(560, entities.length * 18));
    const cx = radius + 80;
    const cy = radius + 80;

    const nodes: Node[] = entities.map((e, i) => {
      const angle = (i / entities.length) * Math.PI * 2;
      return {
        id: e.id,
        type: 'default',
        position: {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        },
        data: { label: e.name },
        style: {
          background: KIND_COLORS[e.kind] ?? '#94a3b8',
          color: '#0a0a0a',
          border: '2px solid rgba(0,0,0,0.2)',
          borderRadius: 999,
          fontSize: 11,
          padding: '4px 10px',
          minWidth: 'auto',
          width: 'auto',
        },
      };
    });

    const entityIds = new Set(entities.map((e) => e.id));
    const edges: Edge[] = relations
      .filter((r) => entityIds.has(r.sourceId) && entityIds.has(r.targetId))
      .map((r) => ({
        id: r.id,
        source: r.sourceId,
        target: r.targetId,
        label: r.type.replace(/_/g, ' '),
        labelStyle: { fontSize: 9, fill: '#94a3b8' },
        style: { stroke: 'rgba(168,139,250,0.5)', strokeWidth: 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(168,139,250,0.6)' },
      }));

    return { nodes, edges };
  }, [entities, relations]);

  if (!universeAddress) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <GitBranch className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
        <p className="mb-2">Pick a universe to view its relationship graph.</p>
        <p className="text-xs">Relations are scoped per-universe.</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground">Loading graph…</div>;
  }

  if (!entities.length) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <GitBranch className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
        <p>No entities in this universe yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {entities.length} node{entities.length !== 1 ? 's' : ''}, {edges.length} edge
          {edges.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          {Object.entries(KIND_COLORS)
            .slice(0, 6)
            .map(([k, c]) => (
              <span key={k} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                {k}
              </span>
            ))}
        </div>
      </div>
      <div className="rounded-lg border bg-background overflow-hidden" style={{ height: 600 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="rgba(255,255,255,0.05)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

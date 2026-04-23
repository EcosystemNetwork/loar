/**
 * Anatomy View — cross-section of a universe as a graph.
 *
 * Creators author universes as a flat grid of people/places/factions. Without
 * a skeleton view, it's impossible to see the actual *shape* of what you've
 * built: who belongs where, who opposes whom, what hangs off what.
 *
 * This route renders all entities in a universe as nodes and all declared
 * relationships as edges, grouped by kind column. Read-only for now — the
 * edit path is still through /wiki/entity/$id.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Position,
  type Edge,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, Network } from 'lucide-react';

const KIND_COLUMNS: string[] = [
  'person',
  'faction',
  'organization',
  'species',
  'place',
  'realm',
  'domain',
  'timeline',
  'event',
  'lore',
  'thing',
  'vehicle',
  'technology',
];

const KIND_COLORS: Record<string, string> = {
  person: '#60a5fa',
  place: '#34d399',
  thing: '#fbbf24',
  faction: '#f87171',
  event: '#fb923c',
  lore: '#2dd4bf',
  species: '#a3e635',
  vehicle: '#94a3b8',
  technology: '#38bdf8',
  organization: '#818cf8',
  moodboard: '#f472b6',
  style_pack: '#e879f9',
  timeline: '#f0abfc',
  reality: '#c4b5fd',
  dimension: '#a78bfa',
  plane: '#67e8f9',
  realm: '#fde047',
  domain: '#fca5a5',
};

const RELATION_COLORS: Record<string, string> = {
  enemy_of: '#ef4444',
  allied_with: '#10b981',
  member_of: '#8b5cf6',
  located_in: '#06b6d4',
  owns: '#eab308',
  rules: '#fbbf24',
  appears_in: '#6366f1',
  related_to: '#94a3b8',
  created_by: '#f472b6',
  uses: '#64748b',
};

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 100;

function AnatomyGraph({ entities, relations }: { entities: any[]; relations: any[] }) {
  const { nodes, edges } = useMemo(() => {
    // Bucket entities by kind
    const buckets = new Map<string, any[]>();
    for (const e of entities) {
      const arr = buckets.get(e.kind) ?? [];
      arr.push(e);
      buckets.set(e.kind, arr);
    }

    // Place each kind in its own column; orphan kinds get trailing columns.
    const orderedKinds = [
      ...KIND_COLUMNS.filter((k) => buckets.has(k)),
      ...[...buckets.keys()].filter((k) => !KIND_COLUMNS.includes(k)),
    ];

    const rfNodes: Node[] = [];
    for (let i = 0; i < orderedKinds.length; i++) {
      const kind = orderedKinds[i];
      const members = buckets.get(kind) ?? [];
      const column = i;
      members.forEach((entity, idx) => {
        rfNodes.push({
          id: entity.id,
          position: { x: column * COLUMN_WIDTH, y: idx * ROW_HEIGHT },
          data: {
            label: (
              <div className="flex flex-col items-start gap-1">
                <Badge
                  style={{
                    background: `${KIND_COLORS[kind] ?? '#64748b'}22`,
                    borderColor: KIND_COLORS[kind] ?? '#64748b',
                    color: KIND_COLORS[kind] ?? '#e2e8f0',
                  }}
                  className="text-[10px] uppercase tracking-wide border"
                >
                  {kind}
                </Badge>
                <span className="text-sm font-medium truncate max-w-[200px]">{entity.name}</span>
              </div>
            ),
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          style: {
            background: '#0f172a',
            border: `1px solid ${KIND_COLORS[kind] ?? '#334155'}66`,
            borderRadius: 8,
            padding: 10,
            width: 220,
          },
        });
      });
    }

    const rfEdges: Edge[] = relations
      .filter((r) => r.sourceId && r.targetId)
      .map((r) => ({
        id: r.id,
        source: r.sourceId,
        target: r.targetId,
        label: r.type.replace(/_/g, ' '),
        style: { stroke: RELATION_COLORS[r.type] ?? '#64748b', strokeWidth: 1.5 },
        labelStyle: { fill: '#cbd5e1', fontSize: 10 },
        labelBgStyle: { fill: '#0f172a' },
        animated: r.type === 'enemy_of',
      }));

    return { nodes: rfNodes, edges: rfEdges };
  }, [entities, relations]);

  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/30 py-16 text-center">
        <Network className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-muted-foreground">
          No entities in this universe yet. Add a few people, places, and factions, then come back
          to see the shape.
        </p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: 720 }} className="rounded-lg border bg-card">
      <ReactFlow nodes={nodes} edges={edges} nodesDraggable fitView minZoom={0.2} maxZoom={1.5}>
        <Background color="#1e293b" gap={24} />
        <Controls />
        <MiniMap zoomable pannable nodeColor={(n: any) => '#334155'} />
      </ReactFlow>
    </div>
  );
}

function AnatomyPage() {
  const { universe } = Route.useParams() as { universe: string };

  const entitiesQuery = useQuery({
    queryKey: ['entities', 'list', universe],
    queryFn: () => trpcClient.entities.list.query({ universeAddress: universe }),
  });

  const relationsQuery = useQuery({
    queryKey: ['entities', 'universeRelations', universe],
    queryFn: () => trpcClient.entities.universeRelations.query({ universeAddress: universe }),
  });

  const universeQuery = useQuery({
    queryKey: ['universe', universe],
    queryFn: () => trpcClient.universes.get.query({ id: universe }),
  });

  const isLoading = entitiesQuery.isLoading || relationsQuery.isLoading;
  const entities = entitiesQuery.data?.entities ?? [];
  const relations = relationsQuery.data?.relations ?? [];
  const universeInfo = universeQuery.data?.data as { id: string; name?: string } | undefined;

  // Breakdown of entity counts per kind for the header strip.
  const breakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entities) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entities]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <Link to="/wiki" search={{}}>
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Wiki
        </Button>
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Network className="w-6 h-6 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Anatomy</h1>
        </div>
        <p className="text-muted-foreground">
          Cross-section of{' '}
          <span className="text-foreground font-semibold">{universeInfo?.name ?? universe}</span>.
          Every entity as a node, every declared relationship as an edge — the skeleton of what
          you've built.
        </p>
      </div>

      {breakdown.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {breakdown.map(([kind, count]) => (
            <Badge
              key={kind}
              variant="outline"
              style={{
                borderColor: `${KIND_COLORS[kind] ?? '#64748b'}66`,
                color: KIND_COLORS[kind] ?? '#e2e8f0',
              }}
            >
              {kind} · {count}
            </Badge>
          ))}
          <Badge variant="outline" className="ml-2">
            {relations.length} relation{relations.length === 1 ? '' : 's'}
          </Badge>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <AnatomyGraph entities={entities} relations={relations} />
      )}
    </div>
  );
}

export const Route = createFileRoute('/anatomy/$universe')({
  component: AnatomyPage,
});

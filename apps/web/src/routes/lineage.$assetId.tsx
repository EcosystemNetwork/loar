/**
 * Provenance View — PRD 10.
 *
 * Renders the lineage for a single asset:
 *   - Ancestor chain (root → self) with prompt/model/credit metadata at each
 *     step.
 *   - Direct descendants (remixes, edits, publishes) rooted at this asset.
 *
 * Reachable as /lineage/:assetId where assetId is a generationId, editJobId,
 * or contentId. Public — no auth needed to view an asset's provenance.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  ArrowRight,
  Film,
  Image as ImageIcon,
  Music2,
  Box,
  Loader2,
  Sparkles,
  GitBranch,
  Coins,
  Clock,
  Shield,
  ExternalLink,
} from 'lucide-react';

export const Route = createFileRoute('/lineage/$assetId')({
  component: LineagePage,
});

type AssetEvent = {
  id: string;
  assetId: string;
  parentAssetId: string | null;
  rootAssetId: string;
  depth: number;
  kind: 'generate' | 'edit' | 'variation' | 'animation' | 'publish';
  tool: string;
  step: string;
  prompt: string | null;
  promptRefs: Array<{ kind: string; url: string; assetId?: string; label?: string }>;
  modelId: string | null;
  modelProvider: string | null;
  creditCost: number;
  latencyMs: number | null;
  creatorUid: string;
  creatorAddress: string | null;
  universeId: string | null;
  universeAddress: string | null;
  rightsClass: 'fan' | 'original' | 'licensed' | null;
  outputUrl: string | null;
  outputKind: 'image' | 'video' | 'audio' | '3d' | 'other';
  status: 'completed' | 'failed';
  createdAt: string;
};

function kindIcon(kind: AssetEvent['outputKind']) {
  if (kind === 'video') return <Film className="h-4 w-4" />;
  if (kind === 'image') return <ImageIcon className="h-4 w-4" />;
  if (kind === 'audio') return <Music2 className="h-4 w-4" />;
  if (kind === '3d') return <Box className="h-4 w-4" />;
  return <Sparkles className="h-4 w-4" />;
}

function kindBadgeColor(kind: AssetEvent['kind']) {
  switch (kind) {
    case 'generate':
      return 'bg-cyan-600';
    case 'edit':
      return 'bg-violet-600';
    case 'publish':
      return 'bg-emerald-600';
    case 'variation':
      return 'bg-amber-600';
    case 'animation':
      return 'bg-pink-600';
    default:
      return 'bg-zinc-600';
  }
}

function rightsColor(rc: AssetEvent['rightsClass']) {
  if (rc === 'original') return 'bg-emerald-600';
  if (rc === 'licensed') return 'bg-amber-600';
  if (rc === 'fan') return 'bg-sky-600';
  return 'bg-zinc-600';
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function AssetPreview({ event }: { event: AssetEvent }) {
  if (!event.outputUrl) {
    return (
      <div className="aspect-video rounded-md bg-zinc-900 flex items-center justify-center text-zinc-500">
        {kindIcon(event.outputKind)}
      </div>
    );
  }
  if (event.outputKind === 'image') {
    return (
      <img
        src={event.outputUrl}
        alt={event.prompt || 'asset'}
        className="aspect-video w-full object-cover rounded-md bg-zinc-900"
        loading="lazy"
      />
    );
  }
  if (event.outputKind === 'video') {
    return (
      <video
        src={event.outputUrl}
        muted
        playsInline
        controls
        className="aspect-video w-full object-cover rounded-md bg-zinc-900"
      />
    );
  }
  return (
    <div className="aspect-video rounded-md bg-zinc-900 flex items-center justify-center text-zinc-500">
      {kindIcon(event.outputKind)}
    </div>
  );
}

function EventCard({ event, highlighted }: { event: AssetEvent; highlighted?: boolean }) {
  return (
    <Card
      className={`p-4 space-y-3 transition-colors ${highlighted ? 'ring-2 ring-cyan-500' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`${kindBadgeColor(event.kind)} text-white`}>{event.kind}</Badge>
          <Badge variant="outline" className="font-mono text-xs">
            {event.step}
          </Badge>
          {event.rightsClass && (
            <Badge className={`${rightsColor(event.rightsClass)} text-white`}>
              <Shield className="h-3 w-3 mr-1" /> {event.rightsClass}
            </Badge>
          )}
          {event.status === 'failed' && (
            <Badge variant="destructive" className="text-xs">
              failed
            </Badge>
          )}
        </div>
        <Link
          to="/lineage/$assetId"
          params={{ assetId: event.assetId }}
          className="text-xs text-zinc-400 hover:text-cyan-400 flex items-center gap-1"
          aria-label="Open this event"
        >
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <AssetPreview event={event} />

      {event.prompt && (
        <p className="text-sm text-zinc-300 line-clamp-3" title={event.prompt}>
          {event.prompt}
        </p>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
        <span className="flex items-center gap-1">
          <Sparkles className="h-3 w-3" /> {event.modelId ?? event.tool}
        </span>
        <span className="flex items-center gap-1">
          <Coins className="h-3 w-3" /> {event.creditCost} credits
        </span>
        {event.latencyMs != null && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {(event.latencyMs / 1000).toFixed(1)}s
          </span>
        )}
        <span className="flex items-center gap-1">{formatDate(event.createdAt)}</span>
      </div>

      {event.promptRefs && event.promptRefs.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {event.promptRefs.slice(0, 6).map((ref, idx) => (
            <Badge key={idx} variant="outline" className="text-[10px]">
              {ref.kind}
              {ref.label ? `: ${ref.label}` : ''}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

function LineagePage() {
  const { assetId } = Route.useParams();

  const ancestorsQuery = useQuery({
    queryKey: ['lineage', 'ancestors', assetId],
    queryFn: () => trpcClient.lineage.ancestors.query({ assetId }),
    staleTime: 60_000,
  });

  const descendantsQuery = useQuery({
    queryKey: ['lineage', 'descendants', assetId],
    queryFn: () => trpcClient.lineage.descendants.query({ assetId, limit: 50 }),
    staleTime: 60_000,
  });

  const ancestors = (ancestorsQuery.data as AssetEvent[] | undefined) ?? [];
  const descendants = (descendantsQuery.data as AssetEvent[] | undefined) ?? [];
  const self = ancestors[ancestors.length - 1];
  const older = ancestors.slice(0, -1);

  const loading = ancestorsQuery.isLoading || descendantsQuery.isLoading;

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/discover">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <GitBranch className="h-5 w-5 text-cyan-500" />
        <div>
          <h1 className="text-xl font-bold">Asset Provenance</h1>
          <p className="text-xs text-zinc-400 font-mono">{assetId}</p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-zinc-400 gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading lineage…
        </div>
      )}

      {!loading && ancestors.length === 0 && (
        <Card className="p-8 text-center text-zinc-400">
          <Sparkles className="h-8 w-8 mx-auto mb-2" />
          <p>No lineage recorded for this asset yet.</p>
          <p className="text-xs mt-2">
            Lineage is captured the moment a generation or edit is completed. Older assets generated
            before this feature shipped won't have an entry.
          </p>
        </Card>
      )}

      {!loading && ancestors.length > 0 && (
        <>
          <section className="mb-8">
            <h2 className="text-sm uppercase tracking-wide text-zinc-500 mb-3">
              Family tree · root → self
            </h2>
            <div className="space-y-3">
              {older.map((ev, idx) => (
                <div key={ev.id}>
                  <EventCard event={ev} />
                  {idx < older.length && (
                    <div className="flex justify-center py-1 text-zinc-600">
                      <ArrowRight className="h-4 w-4 rotate-90" />
                    </div>
                  )}
                </div>
              ))}
              {self && <EventCard event={self} highlighted />}
            </div>
          </section>

          {descendants.length > 0 && (
            <section>
              <h2 className="text-sm uppercase tracking-wide text-zinc-500 mb-3">
                Direct descendants · {descendants.length}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {descendants.map((ev) => (
                  <EventCard key={ev.id} event={ev} />
                ))}
              </div>
            </section>
          )}

          {descendants.length === 0 && (
            <p className="text-xs text-zinc-500 italic">
              No remixes, edits, or publishes derived from this asset yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}

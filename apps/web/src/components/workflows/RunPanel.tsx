import { useWorkflowRun, useCancelRun } from '@/hooks/useWorkflows';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';

interface NodeRunLite {
  id: string;
  nodeId: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  modelUsed: string | null;
  creditsCharged: number;
  durationMs: number;
  error: string | null;
  outputs: Record<string, unknown>;
}

interface RunDoc {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  totalCostCredits: number;
  nodeRuns: NodeRunLite[];
  outputs: Record<string, Record<string, unknown>>;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-slate-200 text-slate-800',
  running: 'bg-blue-200 text-blue-900',
  succeeded: 'bg-emerald-200 text-emerald-900',
  failed: 'bg-red-200 text-red-900',
  cancelled: 'bg-amber-200 text-amber-900',
};

function OutputPreview({ outputs }: { outputs: Record<string, unknown> }) {
  const url = (outputs.imageUrl || outputs.videoUrl || outputs.upscaledUrl) as string | undefined;
  if (!url) return null;
  if (typeof url !== 'string') return null;
  if (outputs.videoUrl) {
    return <video src={url} controls className="mt-2 max-h-40 rounded" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="mt-2 max-h-40 rounded object-contain" />
  );
}

export function RunPanel({
  runId,
  onClose,
  onActiveNodesChange,
}: {
  runId: string | null;
  onClose: () => void;
  onActiveNodesChange?: (ids: string[]) => void;
}) {
  const { data, isLoading } = useWorkflowRun(runId ?? undefined);
  const cancel = useCancelRun();
  const run = data as RunDoc | undefined;

  // Surface in-flight node IDs for canvas highlight
  const activeIds =
    run?.status === 'running'
      ? run.nodeRuns
          .filter((n) => n.status === 'running' || n.status === 'queued')
          .map((n) => n.nodeId)
      : [];
  if (onActiveNodesChange) onActiveNodesChange(activeIds);

  if (!runId) return null;
  return (
    <div className="border-t bg-background p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">Run {runId.slice(0, 8)}</div>
          {run && <Badge className={STATUS_COLOR[run.status] ?? ''}>{run.status}</Badge>}
          {run && (
            <div className="text-xs text-muted-foreground">
              {run.totalCostCredits} credits
              {run.finishedAt
                ? ` · ${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s`
                : null}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {run?.status === 'running' || run?.status === 'queued' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => cancel.mutate(runId)}
              disabled={cancel.isPending}
            >
              Cancel
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading && <div className="mt-2 text-xs text-muted-foreground">Loading run…</div>}

      {run?.error && (
        <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
          {run.error}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {run?.nodeRuns?.map((nr) => (
          <div key={nr.id} className="rounded-md border bg-card p-2 text-xs shadow-sm">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{nr.kind}</div>
              <Badge className={STATUS_COLOR[nr.status] ?? ''}>{nr.status}</Badge>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {nr.modelUsed ?? '—'} · {nr.creditsCharged} cr
              {nr.durationMs ? ` · ${(nr.durationMs / 1000).toFixed(1)}s` : ''}
            </div>
            {nr.error && <div className="mt-1 text-[11px] text-red-600">{nr.error}</div>}
            <OutputPreview outputs={nr.outputs} />
          </div>
        ))}
      </div>
    </div>
  );
}

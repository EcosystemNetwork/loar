import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkflow, useWorkflowRuns } from '@/hooks/useWorkflows';

export const Route = createFileRoute('/workflows/$id/runs')({
  component: WorkflowRunsPage,
});

interface RunDoc {
  id: string;
  status: string;
  totalCostCredits: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  nodeRuns: Array<{
    id: string;
    nodeId: string;
    kind: string;
    status: string;
    modelUsed: string | null;
    creditsCharged: number;
    durationMs: number;
    error: string | null;
    outputs: Record<string, unknown>;
  }>;
  outputs: Record<string, Record<string, unknown>>;
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-slate-200 text-slate-800',
  running: 'bg-blue-200 text-blue-900',
  succeeded: 'bg-emerald-200 text-emerald-900',
  failed: 'bg-red-200 text-red-900',
  cancelled: 'bg-amber-200 text-amber-900',
};

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function WorkflowRunsPage() {
  const { id } = Route.useParams();
  const { data: workflow } = useWorkflow(id);
  const { data, isLoading } = useWorkflowRuns(id);
  const runs = (data?.runs ?? []) as RunDoc[];

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/workflows/$id" params={{ id }}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to editor
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">{workflow?.name ?? 'Workflow'} — runs</h1>
          <div className="text-xs text-muted-foreground">
            Audit trail of every execution: per-node model, cost, duration, output.
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading runs…</div>
      ) : runs.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No runs yet. Open the editor and click <strong>Run</strong>.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {runs.map((run) => (
            <div key={run.id} className="rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-mono text-sm">{run.id.slice(0, 12)}…</div>
                <Badge className={STATUS_COLOR[run.status] ?? ''}>{run.status}</Badge>
                <div className="text-xs text-muted-foreground">
                  {run.totalCostCredits} credits ·{' '}
                  {run.finishedAt ? fmtDuration(run.finishedAt - run.startedAt) : 'in flight'} ·{' '}
                  {new Date(run.startedAt).toLocaleString()}
                </div>
              </div>
              {run.error && (
                <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
                  {run.error}
                </div>
              )}

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {run.nodeRuns.map((nr) => (
                  <div key={nr.id} className="rounded border bg-background p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{nr.kind}</span>
                      <Badge className={STATUS_COLOR[nr.status] ?? ''}>{nr.status}</Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {nr.modelUsed ?? '—'} · {nr.creditsCharged} cr · {fmtDuration(nr.durationMs)}
                    </div>
                    {nr.error && <div className="mt-1 text-[11px] text-red-600">{nr.error}</div>}
                    <NodeOutputPreview outputs={nr.outputs} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NodeOutputPreview({ outputs }: { outputs: Record<string, unknown> }) {
  const url = (outputs.imageUrl ?? outputs.videoUrl) as string | undefined;
  if (!url || typeof url !== 'string') return null;
  if (outputs.videoUrl) return <video src={url} controls className="mt-2 max-h-32 rounded" />;
  return <img src={url} alt="" className="mt-2 max-h-32 rounded object-contain" />;
}

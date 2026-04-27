/**
 * /lab/zai/video/$jobId — async Vidu Q1 job poller.
 *
 * Polls `zai.videoJob` every 4s until status flips to completed or failed.
 * The server caches the job row in Firestore (zaiVideoJobs/{taskId}), so
 * refreshing the page never loses an in-flight render and rehosting only
 * happens once.
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clapperboard, Loader2, RefreshCw } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const Route = createFileRoute('/lab/zai/video/$jobId')({
  component: VideoJobPage,
});

function VideoJobPage() {
  const { jobId } = useParams({ from: '/lab/zai/video/$jobId' });
  const { address } = useWalletAuth();

  const job = useQuery({
    queryKey: ['zai', 'videoJob', jobId],
    queryFn: () => trpcClient.zai.videoJob.query({ taskId: jobId }),
    refetchInterval: (q) => {
      const status = (q.state.data as { status?: string } | undefined)?.status;
      return status === 'completed' || status === 'failed' ? false : 4000;
    },
    refetchIntervalInBackground: true,
  });

  if (!address) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Z.AI video job</h1>
        <p className="text-muted-foreground mt-2">Connect a wallet to view your jobs.</p>
      </div>
    );
  }

  const data = job.data as
    | {
        status?: string;
        videoUrl?: string | null;
        coverUrl?: string | null;
        prompt?: string;
        model?: string;
        error?: string | null;
        createdAt?: string;
        updatedAt?: string;
        aspectRatio?: string | null;
        duration?: number | null;
        imageUrl?: string | null;
      }
    | undefined;

  const status = data?.status ?? 'pending';
  const isTerminal = status === 'completed' || status === 'failed';

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/lab/zai"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Z.AI Lab
        </Link>
        <Button variant="ghost" size="sm" onClick={() => job.refetch()} disabled={job.isFetching}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-violet-400" />
            Vidu Q1 Job
            <Badge
              className={
                status === 'completed'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : status === 'failed'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
              }
            >
              {status}
            </Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground font-mono break-all">{jobId}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {data?.prompt && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Prompt</div>
              <div className="text-sm mt-1">{data.prompt}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            {data?.model && (
              <div>
                <span className="block uppercase tracking-wide">Model</span>
                <span className="text-foreground">{data.model}</span>
              </div>
            )}
            {data?.aspectRatio && (
              <div>
                <span className="block uppercase tracking-wide">Aspect</span>
                <span className="text-foreground">{data.aspectRatio}</span>
              </div>
            )}
            {data?.duration && (
              <div>
                <span className="block uppercase tracking-wide">Duration</span>
                <span className="text-foreground">{data.duration}s</span>
              </div>
            )}
            {data?.createdAt && (
              <div>
                <span className="block uppercase tracking-wide">Started</span>
                <span className="text-foreground">
                  {new Date(data.createdAt).toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>

          {!isTerminal && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-zinc-900/40 border border-white/10 rounded-lg p-3">
              <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
              Rendering — Vidu Q1-3 typically takes 1–3 minutes. Polling every 4s.
            </div>
          )}

          {status === 'failed' && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
              <div className="font-semibold text-rose-300">Render failed</div>
              <p className="text-muted-foreground mt-1">{data?.error ?? 'Unknown error'}</p>
            </div>
          )}

          {status === 'completed' && data?.videoUrl && (
            <div className="space-y-2">
              <video
                controls
                src={data.videoUrl}
                poster={data.coverUrl ?? undefined}
                className="w-full rounded-lg border border-white/10"
              />
              <div className="text-xs text-muted-foreground break-all">
                Hosted: <span className="font-mono">{data.videoUrl}</span>
              </div>
            </div>
          )}

          {data?.imageUrl && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Source image</summary>
              <img
                src={data.imageUrl}
                alt="i2v reference"
                className="mt-2 max-w-xs rounded border border-white/10"
              />
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

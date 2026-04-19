/**
 * Extraction review page — poll the VLM job, then render ExtractionReview.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { ExtractionReview } from '@/components/vlm/ExtractionReview';
import { Loader2 } from 'lucide-react';

export const Route = createFileRoute('/extract/$jobId')({
  component: ExtractPage,
});

function ExtractPage() {
  const { jobId } = Route.useParams();

  const { data: job } = useQuery({
    queryKey: ['vlm-job', jobId],
    queryFn: () => trpcClient.vlm.extract.status.query({ jobId }),
    refetchInterval: (query) => {
      const data = (query.state.data as any) ?? null;
      return data?.status === 'completed' || data?.status === 'failed' ? false : 2000;
    },
  });

  const status = (job as any)?.status;
  const outputRef = (job as any)?.outputRef as string | undefined;

  return (
    <div className="min-h-screen bg-background p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">Extraction Review</h1>
        <p className="text-xs text-muted-foreground">Job {jobId}</p>
      </div>

      {!status || status === 'pending' || status === 'running' ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analyzing video... this usually takes 30–90 seconds.
        </div>
      ) : status === 'failed' ? (
        <div className="text-sm text-rose-400">
          Extraction failed: {(job as any)?.error ?? 'unknown error'}
        </div>
      ) : outputRef ? (
        <ExtractionReview extractionId={outputRef} />
      ) : (
        <div className="text-sm text-muted-foreground">No output produced.</div>
      )}
    </div>
  );
}

/**
 * Client side of the Tripo world-building jobs (server: routers/generation/
 * tripo.routes.ts). Jobs run in the background on the server; these hooks
 * poll `tripo.getJob` and refresh the views that show the job's output.
 */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export type TripoJob = NonNullable<Awaited<ReturnType<typeof trpcClient.tripo.getJob.query>>>;
export type WorldOverviewRow = Awaited<
  ReturnType<typeof trpcClient.tripo.worldOverview.query>
>[number];

export const worldOverviewKey = (universeId: string) => ['tripo', 'worldOverview', universeId];
export const entityJobsKey = (entityId: string) => ['tripo', 'jobs', 'entity', entityId];

/** Recent Tripo jobs for one entity (newest first), polled while any is running. */
export function useEntityTripoJobs(entityId: string, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: entityJobsKey(entityId),
    queryFn: () => trpcClient.tripo.listJobs.query({ entityId, limit: 10 }),
    enabled,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((j) => j.status === 'running') ? 3000 : false,
  });

  // When a job finishes, the entity, its media gallery and the world
  // overview all changed server-side — refresh them once.
  const seenRunning = useRef(new Set<string>());
  useEffect(() => {
    for (const job of query.data ?? []) {
      if (job.status === 'running') {
        seenRunning.current.add(job.id);
      } else if (seenRunning.current.delete(job.id)) {
        void qc.invalidateQueries({ queryKey: ['mediaAttachments', 'entity', entityId] });
        void qc.invalidateQueries({ queryKey: ['entity', entityId] });
        void qc.invalidateQueries({ queryKey: ['tripo', 'worldOverview'] });
      }
    }
  }, [query.data, entityId, qc]);

  return query;
}

/** Poll a single job id until it settles. */
export function useTripoJob(jobId: string | null) {
  return useQuery({
    queryKey: ['tripo', 'job', jobId],
    queryFn: () => trpcClient.tripo.getJob.query({ jobId: jobId! }),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : false),
  });
}

export function useWorldOverview(universeId: string | undefined) {
  return useQuery({
    queryKey: worldOverviewKey(universeId ?? ''),
    queryFn: () => trpcClient.tripo.worldOverview.query({ universeId: universeId! }),
    enabled: !!universeId,
    staleTime: 30_000,
  });
}

/** Overall 0-100 progress of a multi-step job (unknown future steps count as 0). */
export function jobProgress(job: Pick<TripoJob, 'status' | 'steps' | 'kind'>): number {
  if (job.status === 'completed') return 100;
  const expected = EXPECTED_STEPS[job.kind] ?? Math.max(job.steps.length, 1);
  const done = job.steps.reduce(
    (sum, s) => sum + (s.status === 'success' ? 100 : (s.progress ?? 0)),
    0
  );
  return Math.min(99, Math.round(done / expected));
}

const EXPECTED_STEPS: Record<string, number> = {
  entity_model: 1,
  character_puppet: 5,
  segment: 2,
  restyle: 1,
  stylize: 1,
  convert: 1,
  place_splat: 1,
};

export const JOB_LABELS: Record<string, string> = {
  entity_model: '3D model',
  character_puppet: 'Character puppet',
  segment: 'Parts kit',
  restyle: 'Restyle',
  stylize: 'Stylize',
  convert: 'Export',
  place_splat: 'Environment',
};

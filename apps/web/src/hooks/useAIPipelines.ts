/**
 * AI Pipeline Hooks — React Query wrappers for the AI pipeline system
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../utils/trpc';

// ── CRUD ───────────────────────────────────────────────────────────────

export function usePipeline(pipelineId: string | undefined) {
  return useQuery({
    queryKey: ['aiPipelines', 'get', pipelineId],
    queryFn: () => trpc.aiPipelines.get.query({ pipelineId: pipelineId! }),
    enabled: !!pipelineId,
  });
}

export function usePipelinesByAgent(aiAgentId: string | undefined) {
  return useQuery({
    queryKey: ['aiPipelines', 'byAgent', aiAgentId],
    queryFn: () => trpc.aiPipelines.listByAgent.query({ aiAgentId: aiAgentId! }),
    enabled: !!aiAgentId,
  });
}

export function useCreatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpc.aiPipelines.create.mutate>[0]) =>
      trpc.aiPipelines.create.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiPipelines'] });
    },
  });
}

export function useUpdatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpc.aiPipelines.update.mutate>[0]) =>
      trpc.aiPipelines.update.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiPipelines'] });
    },
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pipelineId: string) => trpc.aiPipelines.delete.mutate({ pipelineId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiPipelines'] });
    },
  });
}

// ── Execution ──────────────────────────────────────────────────────────

export function useRunPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { pipelineId: string; overrides?: Record<string, unknown> }) =>
      trpc.aiPipelines.run.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiPipelines', 'runs'] });
    },
  });
}

export function usePipelineRun(runId: string | undefined) {
  return useQuery({
    queryKey: ['aiPipelines', 'run', runId],
    queryFn: () => trpc.aiPipelines.getRun.query({ runId: runId! }),
    enabled: !!runId,
    refetchInterval: (query) => {
      // Auto-poll while running
      const data = query.state.data as any;
      return data?.status === 'running' ? 3000 : false;
    },
  });
}

export function usePipelineRuns(pipelineId: string | undefined, limit: number = 20) {
  return useQuery({
    queryKey: ['aiPipelines', 'runs', pipelineId, limit],
    queryFn: () => trpc.aiPipelines.listRuns.query({ pipelineId: pipelineId!, limit }),
    enabled: !!pipelineId,
  });
}

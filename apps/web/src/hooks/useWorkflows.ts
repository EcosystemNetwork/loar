/**
 * Workflows Hooks — React Query wrappers for the PRD 9 workflow system.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '../utils/trpc';

// ── CRUD ───────────────────────────────────────────────────────────────

export function useWorkflows(limit = 100) {
  return useQuery({
    queryKey: ['workflows', 'list', limit],
    queryFn: () => trpcClient.workflows.list.query({ limit }),
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: ['workflows', 'get', id],
    queryFn: () => trpcClient.workflows.get.query({ id: id! }),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.workflows.create.mutate>[0]) =>
      trpcClient.workflows.create.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.workflows.update.mutate>[0]) =>
      trpcClient.workflows.update.mutate(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['workflows', 'get', vars.id] });
      qc.invalidateQueries({ queryKey: ['workflows', 'list'] });
    },
  });
}

export function useForkWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcClient.workflows.fork.mutate({ id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}

export function useArchiveWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcClient.workflows.archive.mutate({ id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}

// ── Cost / Validation ──────────────────────────────────────────────────

export function useEstimateCost(id: string | undefined) {
  return useQuery({
    queryKey: ['workflows', 'estimateCost', id],
    queryFn: () => trpcClient.workflows.estimateCost.query({ id: id! }),
    enabled: !!id,
  });
}

// ── Runs ───────────────────────────────────────────────────────────────

export function useRunWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; overrides?: Record<string, Record<string, unknown>> }) =>
      trpcClient.workflows.run.mutate({ id: input.id, overrides: input.overrides ?? {} }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['workflows', 'runs', vars.id] });
    },
  });
}

export function useWorkflowRun(runId: string | undefined) {
  return useQuery({
    queryKey: ['workflows', 'run', runId],
    queryFn: () => trpcClient.workflows.getRun.query({ runId: runId! }),
    enabled: !!runId,
    refetchInterval: (query) => {
      const data = query.state.data as { status?: string } | undefined;
      return data?.status === 'queued' || data?.status === 'running' ? 2000 : false;
    },
  });
}

export function useWorkflowRuns(workflowId: string | undefined, limit = 50) {
  return useQuery({
    queryKey: ['workflows', 'runs', workflowId, limit],
    queryFn: () => trpcClient.workflows.listRuns.query({ workflowId: workflowId!, limit }),
    enabled: !!workflowId,
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => trpcClient.workflows.cancelRun.mutate({ runId }),
    onSuccess: (_data, runId) => {
      qc.invalidateQueries({ queryKey: ['workflows', 'run', runId] });
    },
  });
}

// ── Marketplace (Phase 2) ──────────────────────────────────────────────

export function useWorkflowMarketplace(
  args: {
    visibility?: 'paid' | 'canon';
    universeAddress?: string | null;
    limit?: number;
  } = {}
) {
  return useQuery({
    queryKey: ['workflows', 'marketplace', args.visibility, args.universeAddress, args.limit],
    queryFn: () =>
      trpcClient.workflows.listMarketplace.query({
        visibility: args.visibility,
        universeAddress: args.universeAddress ?? undefined,
        limit: args.limit ?? 50,
      }),
  });
}

export function useHasLicense(id: string | undefined) {
  return useQuery({
    queryKey: ['workflows', 'hasLicense', id],
    queryFn: () => trpcClient.workflows.hasLicense.query({ id: id! }),
    enabled: !!id,
  });
}

export function useMyLicenses() {
  return useQuery({
    queryKey: ['workflows', 'myLicenses'],
    queryFn: () => trpcClient.workflows.myLicenses.query({ limit: 100 }),
  });
}

export function usePurchaseWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcClient.workflows.purchase.mutate({ id }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['workflows', 'hasLicense', id] });
      qc.invalidateQueries({ queryKey: ['workflows', 'myLicenses'] });
      qc.invalidateQueries({ queryKey: ['workflows', 'marketplace'] });
    },
  });
}

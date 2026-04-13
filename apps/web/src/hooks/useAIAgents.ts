/**
 * AI Agent Hooks — React Query wrappers for the AI agent system
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '../utils/trpc';

// ── CRUD ───────────────────────────────────────────────────────────────

export function useAIAgent(agentId: string | undefined) {
  return useQuery({
    queryKey: ['aiAgents', 'get', agentId],
    queryFn: () => trpcClient.aiAgents.get.query({ agentId: agentId! }),
    enabled: !!agentId,
  });
}

export function useAIAgentsByUniverse(universeId: string | undefined) {
  return useQuery({
    queryKey: ['aiAgents', 'byUniverse', universeId],
    queryFn: () => trpcClient.aiAgents.listByUniverse.query({ universeId: universeId! }),
    enabled: !!universeId,
  });
}

export function useMyAIAgents() {
  return useQuery({
    queryKey: ['aiAgents', 'myAgents'],
    queryFn: () => trpcClient.aiAgents.listByOwner.query(),
  });
}

export function useCreateAIAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.aiAgents.create.mutate>[0]) =>
      trpcClient.aiAgents.create.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiAgents'] });
    },
  });
}

export function useUpdateAIAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.aiAgents.update.mutate>[0]) =>
      trpcClient.aiAgents.update.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiAgents'] });
    },
  });
}

export function usePauseAIAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => trpcClient.aiAgents.pause.mutate({ agentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiAgents'] });
    },
  });
}

export function useResumeAIAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => trpcClient.aiAgents.resume.mutate({ agentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiAgents'] });
    },
  });
}

export function useDeleteAIAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => trpcClient.aiAgents.delete.mutate({ agentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiAgents'] });
    },
  });
}

// ── Budget ─────────────────────────────────────────────────────────────

export function useAllocateAgentBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { agentId: string; amount: number }) =>
      trpcClient.aiAgents.allocateBudget.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiAgents'] });
    },
  });
}

export function useAIAgentUsage(agentId: string | undefined) {
  return useQuery({
    queryKey: ['aiAgents', 'usage', agentId],
    queryFn: () => trpcClient.aiAgents.getUsage.query({ agentId: agentId! }),
    enabled: !!agentId,
  });
}

// ── Universe Assignments ───────────────────────────────────────────────

export function useUniverseAgentAssignments(universeId: string | undefined) {
  return useQuery({
    queryKey: ['aiAgents', 'universeAssignments', universeId],
    queryFn: () => trpcClient.aiAgents.getUniverseAssignments.query({ universeId: universeId! }),
    enabled: !!universeId,
  });
}

export function useAssignTalentAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { universeId: string; talentAgentUid: string; contractId: string }) =>
      trpcClient.aiAgents.assignTalentAgent.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aiAgents', 'universeAssignments'] });
    },
  });
}

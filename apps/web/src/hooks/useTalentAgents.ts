/**
 * Talent Agent Hooks — React Query wrappers for the talent agent system
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '../utils/trpc';

// ── Profile ────────────────────────────────────────────────────────────

export function useMyAgentProfile() {
  return useQuery({
    queryKey: ['talentAgents', 'myProfile'],
    queryFn: () => trpcClient.talentAgents.myProfile.query(),
  });
}

export function useAgentProfile(uid: string | undefined) {
  return useQuery({
    queryKey: ['talentAgents', 'profile', uid],
    queryFn: () => trpcClient.talentAgents.getProfile.query({ uid: uid! }),
    enabled: !!uid,
  });
}

export function useDiscoverAgents(params: {
  search?: string;
  specialties?: string[];
  verifiedOnly?: boolean;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['talentAgents', 'discover', params],
    queryFn: () => trpcClient.talentAgents.discover.query(params),
  });
}

export function useRegisterAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.talentAgents.register.mutate>[0]) =>
      trpcClient.talentAgents.register.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentAgents'] });
    },
  });
}

// ── Contracts ──────────────────────────────────────────────────────────

export function useMyContracts(status: string = 'ALL') {
  return useQuery({
    queryKey: ['talentAgents', 'myContracts', status],
    queryFn: () => trpcClient.talentAgents.myContracts.query({ status: status as any }),
  });
}

export function useAgentClients() {
  return useQuery({
    queryKey: ['talentAgents', 'clients'],
    queryFn: () => trpcClient.talentAgents.getClients.query(),
  });
}

export function useProposeContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.talentAgents.proposeContract.mutate>[0]) =>
      trpcClient.talentAgents.proposeContract.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentAgents'] });
    },
  });
}

export function useAgentCommissionStats() {
  return useQuery({
    queryKey: ['talentAgents', 'commissionStats'],
    queryFn: () => trpcClient.talentAgents.getCommissionStats.query(),
  });
}

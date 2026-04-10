/**
 * Talent Agent Hooks — React Query wrappers for the talent agent system
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../utils/trpc';

// ── Profile ────────────────────────────────────────────────────────────

export function useMyAgentProfile() {
  return useQuery({
    queryKey: ['talentAgents', 'myProfile'],
    queryFn: () => trpc.talentAgents.myProfile.query(),
  });
}

export function useAgentProfile(uid: string | undefined) {
  return useQuery({
    queryKey: ['talentAgents', 'profile', uid],
    queryFn: () => trpc.talentAgents.getProfile.query({ uid: uid! }),
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
    queryFn: () => trpc.talentAgents.discover.query(params),
  });
}

export function useRegisterAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpc.talentAgents.register.mutate>[0]) =>
      trpc.talentAgents.register.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentAgents'] });
    },
  });
}

export function useUpdateAgentProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpc.talentAgents.updateProfile.mutate>[0]) =>
      trpc.talentAgents.updateProfile.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentAgents'] });
    },
  });
}

// ── Contracts ──────────────────────────────────────────────────────────

export function useMyContracts(status: string = 'ALL') {
  return useQuery({
    queryKey: ['talentAgents', 'myContracts', status],
    queryFn: () => trpc.talentAgents.myContracts.query({ status: status as any }),
  });
}

export function useAgentClients() {
  return useQuery({
    queryKey: ['talentAgents', 'clients'],
    queryFn: () => trpc.talentAgents.getClients.query(),
  });
}

export function useAgentContract(contractId: string | undefined) {
  return useQuery({
    queryKey: ['talentAgents', 'contract', contractId],
    queryFn: () => trpc.talentAgents.getContract.query({ contractId: contractId! }),
    enabled: !!contractId,
  });
}

export function useProposeContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpc.talentAgents.proposeContract.mutate>[0]) =>
      trpc.talentAgents.proposeContract.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentAgents'] });
    },
  });
}

export function useAcceptContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string }) => trpc.talentAgents.acceptContract.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentAgents'] });
    },
  });
}

export function useTerminateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; reason?: string }) =>
      trpc.talentAgents.terminateContract.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentAgents'] });
    },
  });
}

// ── Commissions ────────────────────────────────────────────────────────

export function useAgentCommissions(limit: number = 50) {
  return useQuery({
    queryKey: ['talentAgents', 'commissions', limit],
    queryFn: () => trpc.talentAgents.getCommissions.query({ limit }),
  });
}

export function useAgentCommissionStats() {
  return useQuery({
    queryKey: ['talentAgents', 'commissionStats'],
    queryFn: () => trpc.talentAgents.getCommissionStats.query(),
  });
}

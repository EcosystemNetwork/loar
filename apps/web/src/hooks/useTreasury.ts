/**
 * Treasury hooks — connects frontend to universeTreasury tRPC endpoints
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

// ---- Pool Balance ----

export function usePoolBalance(universeId: string) {
  return useQuery({
    queryKey: ['treasury-pool', universeId],
    queryFn: () => trpcClient.universeTreasury.getPoolBalance.query({ universeId }),
    enabled: !!universeId,
  });
}

// ---- Pool History ----

export function usePoolHistory(universeId: string, limit = 50) {
  return useQuery({
    queryKey: ['treasury-history', universeId, limit],
    queryFn: () => trpcClient.universeTreasury.getPoolHistory.query({ universeId, limit }),
    enabled: !!universeId,
  });
}

// ---- Fund Pool (admin) ----

export function useFundPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.universeTreasury.fundPool.mutate>[0]) =>
      trpcClient.universeTreasury.fundPool.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury-pool'] });
      qc.invalidateQueries({ queryKey: ['treasury-history'] });
    },
  });
}

// ---- Spend From Pool (team members) ----

export function useSpendFromPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.universeTreasury.spendFromPool.mutate>[0]) =>
      trpcClient.universeTreasury.spendFromPool.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury-pool'] });
      qc.invalidateQueries({ queryKey: ['treasury-history'] });
    },
  });
}

// ---- Allocate Credits to Member (admin) ----

export function useAllocateToMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input: Parameters<typeof trpcClient.universeTreasury.allocateToMember.mutate>[0]
    ) => trpcClient.universeTreasury.allocateToMember.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury-pool'] });
      qc.invalidateQueries({ queryKey: ['treasury-history'] });
    },
  });
}

// ---- Deposit Revenue (admin) ----

export function useDepositRevenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.universeTreasury.depositRevenue.mutate>[0]) =>
      trpcClient.universeTreasury.depositRevenue.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury-pool'] });
      qc.invalidateQueries({ queryKey: ['treasury-history'] });
    },
  });
}

// ---- My Allowance (member's own budget visibility) ----

export function useMyAllowance(universeId: string) {
  return useQuery({
    queryKey: ['my-allowance', universeId],
    queryFn: async () => {
      const result = await trpcClient.universeTeam.isMember.query({ universeId });
      if (!result.isMember || !result.membership) return null;
      const m = result.membership as Record<string, any>;
      return {
        monthlyAllowance: (m.monthlyAllowance as number) || 0,
        creditsUsedThisMonth: (m.creditsUsedThisMonth as number) || 0,
        remaining:
          m.monthlyAllowance > 0
            ? Math.max(0, m.monthlyAllowance - (m.creditsUsedThisMonth || 0))
            : null, // null = unlimited
      };
    },
    enabled: !!universeId,
  });
}

// ---- Team Members (for allocation dropdown) ----

export function useTeamMembers(universeId: string) {
  return useQuery({
    queryKey: ['team-members', universeId],
    queryFn: () => trpcClient.universeTeam.getMembers.query({ universeId }),
    enabled: !!universeId,
  });
}

/**
 * Universe Generation Config Hooks
 *
 * TanStack Query hooks for managing universe generation tool configurations.
 * Used by universe admins to define generation parameters and by generators
 * to check access and see constraints.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../utils/trpc';

/** Get generation config for a universe */
export function useUniverseGenConfig(universeId: string | undefined) {
  return useQuery({
    queryKey: ['universeGenConfig', universeId],
    queryFn: () => (universeId ? trpc.universeGenConfig.get.query({ universeId }) : null),
    enabled: !!universeId,
  });
}

/** Create or update generation config */
export function useUpsertGenConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      universeAddress: string;
      approvedModelIds?: string[];
      blockedModelIds?: string[];
      styleGuide?: string;
      referenceImageUrls?: string[];
      negativePrompts?: string[];
      defaultPromptPrefix?: string;
      defaultPromptSuffix?: string;
      requiredEntityIds?: string[];
      loreEntityIds?: string[];
      loreRules?: Array<{ rule: string; type: 'DO' | 'DONT' }>;
      creditMultiplier?: number;
      minCreditsPerGen?: number;
      accessType?: 'PUBLIC' | 'HOLDERS' | 'WHITELISTED';
      whitelistedAddresses?: string[];
      requiredTokenBalance?: number;
      universeCreatorSplitBps?: number;
    }) => trpc.universeGenConfig.upsert.mutate(input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['universeGenConfig', variables.universeAddress] });
    },
  });
}

/** Check if current user has access to generate in a universe */
export function useCheckGenAccess(universeId: string | undefined) {
  return useQuery({
    queryKey: ['universeGenConfig', 'checkAccess', universeId],
    queryFn: () => (universeId ? trpc.universeGenConfig.checkAccess.query({ universeId }) : null),
    enabled: !!universeId,
  });
}

/** Get approved models for a universe */
export function useApprovedModels(universeId: string | undefined) {
  return useQuery({
    queryKey: ['universeGenConfig', 'approvedModels', universeId],
    queryFn: () =>
      universeId ? trpc.universeGenConfig.getApprovedModels.query({ universeId }) : null,
    enabled: !!universeId,
  });
}

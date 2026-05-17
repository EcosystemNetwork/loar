/**
 * API Key Management Hooks — React Query wrappers for API key CRUD
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '../utils/trpc';

export function useApiKeys() {
  return useQuery({
    queryKey: ['apiKeys', 'list'],
    queryFn: () => trpcClient.apiKeys.list.query(),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.apiKeys.create.mutate>[0]) =>
      trpcClient.apiKeys.create.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apiKeys'] });
    },
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => trpcClient.apiKeys.revoke.mutate({ keyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apiKeys'] });
    },
  });
}

export function useApiKeyUsage(keyId: string | undefined) {
  return useQuery({
    queryKey: ['apiKeys', 'usage', keyId],
    queryFn: () => trpcClient.apiKeys.getUsage.query({ keyId: keyId! }),
    enabled: !!keyId,
  });
}

export function useAvailablePermissions() {
  return useQuery({
    queryKey: ['apiKeys', 'permissions'],
    queryFn: () => trpcClient.apiKeys.availablePermissions.query(),
  });
}

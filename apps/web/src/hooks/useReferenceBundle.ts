import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '../utils/trpc';

export const REFERENCE_SLOTS = ['character', 'outfit', 'prop', 'environment', 'style'] as const;
export type ReferenceSlot = (typeof REFERENCE_SLOTS)[number];

export const REFERENCE_SLOT_LABELS: Record<ReferenceSlot, string> = {
  character: 'Character',
  outfit: 'Outfit',
  prop: 'Prop',
  environment: 'Environment',
  style: 'Style',
};

export const IDENTITY_LOCKS = ['face', 'costume', 'colors', 'silhouette'] as const;
export type IdentityLock = (typeof IDENTITY_LOCKS)[number];

export const IDENTITY_LOCK_LABELS: Record<IdentityLock, string> = {
  face: 'Lock Face',
  costume: 'Lock Costume',
  colors: 'Lock Colors',
  silhouette: 'Lock Silhouette',
};

export const MAX_REFS_PER_SLOT = 3;

export interface ResolvedReferenceBundle {
  slots: Partial<Record<ReferenceSlot, string[]>>;
  locks: Partial<Record<IdentityLock, boolean>>;
  identityStrength: number;
  updatedAt: string | Date;
  directSlots: ReferenceSlot[];
  inheritedFrom: Partial<Record<ReferenceSlot, { entityId: string; entityName: string }>>;
}

/** Get the resolved reference bundle for an entity (walks the parent chain). */
export function useReferenceBundle(entityId: string | undefined, includeInherited = true) {
  return useQuery({
    queryKey: ['reference-bundle', entityId, includeInherited],
    queryFn: async () =>
      trpcClient.entities.getReferenceBundle.query({
        entityId: entityId!,
        includeInherited,
      }),
    enabled: !!entityId,
  });
}

/** Replace the reference bundle on an entity (direct slots/locks only, no inheritance). */
export function useSetReferenceBundle(entityId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      slots: Partial<Record<ReferenceSlot, string[]>>;
      locks: Partial<Record<IdentityLock, boolean>>;
      identityStrength: number;
    }) =>
      trpcClient.entities.setReferenceBundle.mutate({
        entityId: entityId!,
        slots: input.slots as any,
        locks: input.locks as any,
        identityStrength: input.identityStrength,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reference-bundle', entityId] });
    },
  });
}

export function useClearReferenceBundle(entityId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => trpcClient.entities.clearReferenceBundle.mutate({ entityId: entityId! }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reference-bundle', entityId] });
    },
  });
}

/** Count how many reference images are attached across all slots. */
export function countBundleRefs(bundle: ResolvedReferenceBundle | null | undefined): number {
  if (!bundle) return 0;
  let total = 0;
  for (const slot of REFERENCE_SLOTS) total += bundle.slots?.[slot]?.length ?? 0;
  return total;
}

/** Count active locks. */
export function countActiveLocks(bundle: ResolvedReferenceBundle | null | undefined): number {
  if (!bundle) return 0;
  return IDENTITY_LOCKS.filter((k) => bundle.locks?.[k] === true).length;
}

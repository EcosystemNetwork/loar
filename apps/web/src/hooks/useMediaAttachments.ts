import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export type MediaCategory =
  | 'image'
  | 'video'
  | 'music'
  | 'sound'
  | 'environment'
  | '3d'
  | 'texture'
  | 'animation'
  | 'rig'
  | 'document'
  | 'design'
  | 'other';

export type AttachmentTargetType = 'universe' | 'entity';

export interface MediaAttachment {
  id: string;
  contentHash: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  url: string;
  targetType: AttachmentTargetType;
  targetId: string;
  targetName: string;
  category: MediaCategory;
  label: string;
  subCategory: string | null;
  version: number;
  variantOf: string | null;
  variantLabel: string | null;
  sortOrder: number;
  generationId: string | null;
  creator: string;
  createdAt: string;
  updatedAt: string;
}

export function useMediaAttachments(targetType: AttachmentTargetType, targetId: string) {
  return useQuery({
    queryKey: ['mediaAttachments', targetType, targetId],
    queryFn: () => trpcClient.media.listByTarget.query({ targetType, targetId }),
    enabled: !!targetId,
  });
}

export function useMediaVariants(attachmentId: string | null) {
  return useQuery({
    queryKey: ['mediaVariants', attachmentId],
    queryFn: () => trpcClient.media.variants.query({ attachmentId: attachmentId! }),
    enabled: !!attachmentId,
  });
}

export function useAttachMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contentHash: string;
      originalFilename: string;
      mimeType: string;
      size: number;
      url: string;
      targetType: AttachmentTargetType;
      targetId: string;
      targetName: string;
      category: MediaCategory;
      label: string;
      subCategory?: string | null;
      version?: number;
      variantOf?: string | null;
      variantLabel?: string | null;
      sortOrder?: number;
      generationId?: string | null;
    }) => trpcClient.media.attach.mutate(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['mediaAttachments', vars.targetType, vars.targetId] });
    },
  });
}

export function useDetachMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; targetType: AttachmentTargetType; targetId: string }) =>
      trpcClient.media.detach.mutate({ id: vars.id }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['mediaAttachments', vars.targetType, vars.targetId] });
    },
  });
}

export function useUpdateMediaAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      category?: MediaCategory;
      label?: string;
      subCategory?: string | null;
      version?: number;
      variantOf?: string | null;
      variantLabel?: string | null;
      sortOrder?: number;
      targetType?: AttachmentTargetType;
      targetId?: string;
      targetName?: string;
    }) => trpcClient.media.update.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mediaAttachments'] });
    },
  });
}

export function useReorderMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { items: { id: string; sortOrder: number }[] }) =>
      trpcClient.media.reorder.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mediaAttachments'] });
    },
  });
}

/** Group attachments by category, respecting sortOrder within each group. */
export function groupByCategory(attachments: MediaAttachment[]) {
  const groups: Partial<Record<MediaCategory, MediaAttachment[]>> = {};
  for (const att of attachments) {
    if (!groups[att.category]) groups[att.category] = [];
    groups[att.category]!.push(att);
  }
  // Sort within each category by sortOrder, then by createdAt desc
  for (const items of Object.values(groups)) {
    items!.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }
  return groups;
}

/** Group attachments that share a variantOf chain (variants of the same base asset). */
export function groupByVariant(attachments: MediaAttachment[]) {
  const roots: MediaAttachment[] = [];
  const variantMap = new Map<string, MediaAttachment[]>();

  for (const att of attachments) {
    if (att.variantOf) {
      if (!variantMap.has(att.variantOf)) variantMap.set(att.variantOf, []);
      variantMap.get(att.variantOf)!.push(att);
    } else {
      roots.push(att);
    }
  }

  return roots.map((root) => ({
    root,
    variants: variantMap.get(root.id) ?? [],
  }));
}

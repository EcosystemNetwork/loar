import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export type MediaCategory =
  | 'image'
  | 'video'
  | 'music'
  | 'sound'
  | 'environment'
  | '3d'
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
      targetType?: AttachmentTargetType;
      targetId?: string;
      targetName?: string;
    }) => trpcClient.media.update.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mediaAttachments'] });
    },
  });
}

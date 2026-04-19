/**
 * useEditSession — opens an edit session against an asset, exposes the
 * session id + base version, and handles mask upload + job dispatch.
 *
 * Reuses `editJobs` tRPC procedures. The actual mask drawing lives in
 * `InpaintCanvas`; this hook owns the server round-trip.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';

type BaseVersion = Awaited<
  ReturnType<typeof trpcClient.editJobs.openSession.mutate>
>['baseVersion'];

export interface UseEditSessionResult {
  sessionId: string | null;
  baseVersion: BaseVersion | null;
  isOpening: boolean;
  uploadMask: (pngBase64: string) => Promise<{ maskId: string; url: string }>;
  runInpaint: (args: {
    maskId: string;
    prompt: string;
    mode: 'replace' | 'remove' | 'add' | 'fix';
    modelId?: string;
  }) => Promise<{ jobId: string; outputUrl: string }>;
  submitJob: (args: {
    jobId: string;
    label?: string;
  }) => Promise<{ versionId: string; versionNumber: number; mediaUrl: string }>;
}

export function useEditSession(contentId: string): UseEditSessionResult {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState<BaseVersion | null>(null);
  const [isOpening, setIsOpening] = useState(true);
  const openedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!contentId || openedFor.current === contentId) return;
    openedFor.current = contentId;
    setIsOpening(true);
    trpcClient.editJobs.openSession
      .mutate({ contentId })
      .then((res) => {
        setSessionId(res.sessionId);
        setBaseVersion(res.baseVersion);
      })
      .catch((err) => {
        console.error('[useEditSession] openSession failed:', err);
        toast.error(err.message || 'Failed to open edit session');
      })
      .finally(() => setIsOpening(false));
  }, [contentId]);

  const uploadMaskMutation = useMutation({
    mutationFn: async (pngBase64: string) => {
      if (!sessionId) throw new Error('No active session');
      return trpcClient.editJobs.uploadMask.mutate({ sessionId, pngBase64 });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (args: {
      maskId: string;
      prompt: string;
      mode: 'replace' | 'remove' | 'add' | 'fix';
      modelId?: string;
    }) => {
      if (!sessionId) throw new Error('No active session');
      return trpcClient.editJobs.create.mutate({
        sessionId,
        ops: [
          {
            kind: 'inpaint',
            maskId: args.maskId,
            prompt: args.prompt,
            mode: args.mode,
            modelId: args.modelId ?? 'inpaint-flux',
          },
        ],
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (args: { jobId: string; label?: string }) => {
      if (!sessionId) throw new Error('No active session');
      return trpcClient.editJobs.submit.mutate({
        sessionId,
        jobId: args.jobId,
        label: args.label,
      });
    },
  });

  const uploadMask = useCallback(
    async (pngBase64: string) => {
      const res = await uploadMaskMutation.mutateAsync(pngBase64);
      return { maskId: res.maskId, url: res.url };
    },
    [uploadMaskMutation]
  );

  const runInpaint = useCallback<UseEditSessionResult['runInpaint']>(
    async (args) => {
      const res = await createMutation.mutateAsync(args);
      return { jobId: res.jobId, outputUrl: res.outputUrl };
    },
    [createMutation]
  );

  const submitJob = useCallback<UseEditSessionResult['submitJob']>(
    async (args) => {
      return submitMutation.mutateAsync(args);
    },
    [submitMutation]
  );

  return { sessionId, baseVersion, isOpening, uploadMask, runInpaint, submitJob };
}

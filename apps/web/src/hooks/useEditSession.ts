/**
 * useEditSession — opens an edit session against an asset, exposes the
 * session id + base version, and handles mask upload, frame capture, and
 * job dispatch for all edit op kinds.
 *
 * Server round-trips go through `editJobs` tRPC procedures. Canvas drawing
 * lives in `InpaintCanvas`; video frame capture happens client-side and is
 * sent to the server as a data URL via captureFrame.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';

type BaseVersion = Awaited<
  ReturnType<typeof trpcClient.editJobs.openSession.mutate>
>['baseVersion'];

type OutpaintAspect = '1:1' | '4:5' | '16:9' | '9:16' | '21:9';

export interface UseEditSessionResult {
  sessionId: string | null;
  baseVersion: BaseVersion | null;
  capturedFrameUrl: string | null;
  isOpening: boolean;
  uploadMask: (pngBase64: string) => Promise<{ maskId: string; url: string }>;
  captureFrame: (args: {
    frameDataUrl: string;
    time: number;
  }) => Promise<{ url: string; time: number }>;
  clearCapturedFrame: () => Promise<void>;
  runInpaint: (args: {
    maskId: string;
    prompt: string;
    mode: 'replace' | 'remove' | 'add' | 'fix';
    modelId?: string;
  }) => Promise<{ jobId: string; outputUrl: string }>;
  runOutpaint: (args: {
    targetAspect: OutpaintAspect;
    anchorX?: number;
    anchorY?: number;
    zoomFactor?: number;
    mode?: 'preserve' | 'creative';
    prompt?: string;
    negativePrompt?: string;
  }) => Promise<{ jobId: string; outputUrl: string }>;
  runRelight: (args: {
    presetIds: string[];
    freeText?: string;
    tonePackId?: string;
    modelId?: string;
  }) => Promise<{ jobId: string; outputUrl: string }>;
  runRetexture: (args: {
    prompt: string;
    negativePrompt?: string;
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
  const [capturedFrameUrl, setCapturedFrameUrl] = useState<string | null>(null);
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

  const captureFrameMutation = useMutation({
    mutationFn: async (args: { frameDataUrl: string; time: number }) => {
      if (!sessionId) throw new Error('No active session');
      return trpcClient.editJobs.captureFrame.mutate({
        sessionId,
        frameDataUrl: args.frameDataUrl,
        time: args.time,
      });
    },
    onSuccess: (res) => setCapturedFrameUrl(res.url),
  });

  const clearFrameMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('No active session');
      return trpcClient.editJobs.clearCapturedFrame.mutate({ sessionId });
    },
    onSuccess: () => setCapturedFrameUrl(null),
  });

  const createMutation = useMutation({
    mutationFn: async (ops: any[]) => {
      if (!sessionId) throw new Error('No active session');
      return trpcClient.editJobs.create.mutate({ sessionId, ops });
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

  const captureFrame = useCallback<UseEditSessionResult['captureFrame']>(
    (args) => captureFrameMutation.mutateAsync(args),
    [captureFrameMutation]
  );

  const clearCapturedFrame = useCallback(async () => {
    await clearFrameMutation.mutateAsync();
  }, [clearFrameMutation]);

  const runInpaint = useCallback<UseEditSessionResult['runInpaint']>(
    async (args) => {
      const res = await createMutation.mutateAsync([
        {
          kind: 'inpaint',
          maskId: args.maskId,
          prompt: args.prompt,
          mode: args.mode,
          modelId: args.modelId ?? 'inpaint-flux',
        },
      ]);
      return { jobId: res.jobId, outputUrl: res.outputUrl };
    },
    [createMutation]
  );

  const runOutpaint = useCallback<UseEditSessionResult['runOutpaint']>(
    async (args) => {
      const res = await createMutation.mutateAsync([
        {
          kind: 'outpaint',
          targetAspect: args.targetAspect,
          anchorX: args.anchorX ?? 0.5,
          anchorY: args.anchorY ?? 0.5,
          zoomFactor: args.zoomFactor ?? 1,
          mode: args.mode ?? 'preserve',
          prompt: args.prompt ?? '',
          negativePrompt: args.negativePrompt,
        },
      ]);
      return { jobId: res.jobId, outputUrl: res.outputUrl };
    },
    [createMutation]
  );

  const runRelight = useCallback<UseEditSessionResult['runRelight']>(
    async (args) => {
      const res = await createMutation.mutateAsync([
        {
          kind: 'relight',
          presetIds: args.presetIds,
          freeText: args.freeText,
          tonePackId: args.tonePackId,
          modelId: args.modelId ?? 'relight-nano-banana',
        },
      ]);
      return { jobId: res.jobId, outputUrl: res.outputUrl };
    },
    [createMutation]
  );

  const runRetexture = useCallback<UseEditSessionResult['runRetexture']>(
    async (args) => {
      const res = await createMutation.mutateAsync([
        {
          kind: 'retexture',
          prompt: args.prompt,
          negativePrompt: args.negativePrompt,
          modelId: args.modelId ?? 'retexture-nano-banana',
        },
      ]);
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

  return {
    sessionId,
    baseVersion,
    capturedFrameUrl,
    isOpening,
    uploadMask,
    captureFrame,
    clearCapturedFrame,
    runInpaint,
    runOutpaint,
    runRelight,
    runRetexture,
    submitJob,
  };
}

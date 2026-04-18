/**
 * Video Editing Hook
 *
 * Provides mutations for all editing operations:
 * upscale, interpolate, restyle, inpaint, remove background, extend.
 */

import { useState, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export type EditingOperation =
  | 'upscale'
  | 'interpolate'
  | 'restyle'
  | 'inpaint'
  | 'remove_bg'
  | 'extend';

export interface EditingModel {
  id: string;
  operation: EditingOperation;
  displayName: string;
  shortDescription: string;
  tier: string;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  creditCost: number;
  supportsVideo: boolean;
  supportsImage: boolean;
  tags: string[];
  bestFor: string;
}

export interface EditingResult {
  jobId: string;
  videoUrl?: string;
  imageUrl?: string;
  model: string;
}

export function useVideoEditing() {
  const [activeOperation, setActiveOperation] = useState<EditingOperation | null>(null);
  const [lastResult, setLastResult] = useState<EditingResult | null>(null);

  // Fetch available editing models
  const modelsQuery = useQuery({
    queryKey: ['editing', 'models'],
    queryFn: () => trpcClient.editing.listModels.query(),
    staleTime: 5 * 60_000,
  });

  const models = (modelsQuery.data || []) as EditingModel[];

  const getModelsForOperation = useCallback(
    (op: EditingOperation) => models.filter((m) => m.operation === op),
    [models]
  );

  // ── Upscale mutation ────────────────────────────────────────────────

  const upscaleMutation = useMutation({
    mutationFn: (input: {
      imageUrl: string;
      modelId?: string;
      prompt?: string;
      scale?: number;
      sourceGenerationId?: string;
    }) => trpcClient.editing.upscale.mutate(input),
    onMutate: () => setActiveOperation('upscale'),
    onSuccess: (data) => {
      setLastResult({ jobId: data.jobId, imageUrl: data.imageUrl, model: data.model });
      setActiveOperation(null);
    },
    onError: () => setActiveOperation(null),
  });

  // ── Interpolate mutation ────────────────────────────────────────────

  const interpolateMutation = useMutation({
    mutationFn: (input: {
      videoUrl: string;
      multiplier?: number;
      modelId?: string;
      sourceGenerationId?: string;
    }) => trpcClient.editing.interpolate.mutate(input),
    onMutate: () => setActiveOperation('interpolate'),
    onSuccess: (data) => {
      setLastResult({ jobId: data.jobId, videoUrl: data.videoUrl, model: data.model });
      setActiveOperation(null);
    },
    onError: () => setActiveOperation(null),
  });

  // ── Restyle mutation ────────────────────────────────────────────────

  const restyleMutation = useMutation({
    mutationFn: (input: {
      videoUrl: string;
      prompt: string;
      modelId?: string;
      strength?: number;
      negativePrompt?: string;
      sourceGenerationId?: string;
    }) => trpcClient.editing.restyle.mutate(input),
    onMutate: () => setActiveOperation('restyle'),
    onSuccess: (data) => {
      setLastResult({ jobId: data.jobId, videoUrl: data.videoUrl, model: data.model });
      setActiveOperation(null);
    },
    onError: () => setActiveOperation(null),
  });

  // ── Inpaint mutation ────────────────────────────────────────────────

  const inpaintMutation = useMutation({
    mutationFn: (input: {
      imageUrl: string;
      maskUrl: string;
      prompt: string;
      modelId?: string;
      negativePrompt?: string;
      sourceGenerationId?: string;
    }) => trpcClient.editing.inpaint.mutate(input),
    onMutate: () => setActiveOperation('inpaint'),
    onSuccess: (data) => {
      setLastResult({ jobId: data.jobId, imageUrl: data.imageUrl, model: data.model });
      setActiveOperation(null);
    },
    onError: () => setActiveOperation(null),
  });

  // ── Remove Background mutation ──────────────────────────────────────

  const removeBackgroundMutation = useMutation({
    mutationFn: (input: { imageUrl: string; modelId?: string; sourceGenerationId?: string }) =>
      trpcClient.editing.removeBackground.mutate(input),
    onMutate: () => setActiveOperation('remove_bg'),
    onSuccess: (data) => {
      setLastResult({ jobId: data.jobId, imageUrl: data.imageUrl, model: data.model });
      setActiveOperation(null);
    },
    onError: () => setActiveOperation(null),
  });

  // ── Extend mutation ─────────────────────────────────────────────────

  const extendMutation = useMutation({
    mutationFn: (input: {
      videoUrl: string;
      prompt: string;
      durationSec?: number;
      modelId?: string;
      sourceGenerationId?: string;
    }) => trpcClient.editing.extend.mutate(input),
    onMutate: () => setActiveOperation('extend'),
    onSuccess: (data) => {
      setLastResult({ jobId: data.jobId, videoUrl: data.videoUrl, model: data.model });
      setActiveOperation(null);
    },
    onError: () => setActiveOperation(null),
  });

  const isProcessing =
    upscaleMutation.isPending ||
    interpolateMutation.isPending ||
    restyleMutation.isPending ||
    inpaintMutation.isPending ||
    removeBackgroundMutation.isPending ||
    extendMutation.isPending;

  return {
    // State
    activeOperation,
    lastResult,
    isProcessing,
    models,
    getModelsForOperation,

    // Mutations
    upscale: upscaleMutation.mutateAsync,
    interpolate: interpolateMutation.mutateAsync,
    restyle: restyleMutation.mutateAsync,
    inpaint: inpaintMutation.mutateAsync,
    removeBackground: removeBackgroundMutation.mutateAsync,
    extend: extendMutation.mutateAsync,

    // Raw mutations for status checking
    mutations: {
      upscale: upscaleMutation,
      interpolate: interpolateMutation,
      restyle: restyleMutation,
      inpaint: inpaintMutation,
      removeBackground: removeBackgroundMutation,
      extend: extendMutation,
    },
  };
}

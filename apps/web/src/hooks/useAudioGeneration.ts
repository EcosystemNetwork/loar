/**
 * Audio/Music Generation Hook
 *
 * Handles music and audio generation using AI models (Stable Audio, MusicGen).
 * Supports text-to-music and text-to-sound generation modes.
 */

import { useState, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { trpcClient, trpc } from '@/utils/trpc';
import { useCreditCheck } from '@/hooks/useCreditCheck';
import { toast } from 'sonner';

export type AudioMode = 'text_to_music' | 'text_to_sound';

export interface AudioModel {
  id: string;
  displayName: string;
  shortDescription: string;
  mode: AudioMode[];
  qualityTier: string;
  maxDurationSec: number;
  supportedDurations: number[];
  fiatPriceUsd: number;
  loarPriceUsd: number;
  creditCost: number;
  tags: string[];
  bestFor: string;
}

export interface UseAudioGenerationProps {
  entityId?: string;
  universeId?: string;
}

export function useAudioGeneration({ entityId, universeId }: UseAudioGenerationProps = {}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const { checkCredits, invalidateBalance } = useCreditCheck();

  // Fetch available models
  const { data: models = [] } = useQuery({
    ...trpc.audio.listModels.queryOptions(),
    staleTime: 5 * 60 * 1000,
  });

  // Estimate cost
  const estimateCost = useCallback(
    async (opts: { mode?: AudioMode; durationSec?: number; modelId?: string }) => {
      return trpcClient.audio.estimateCost.query({
        mode: opts.mode || 'text_to_music',
        durationSec: opts.durationSec || 15,
        modelId: opts.modelId,
      });
    },
    []
  );

  // Generation mutation
  const generateMutation = useMutation({
    mutationFn: async (input: {
      prompt: string;
      mode?: AudioMode;
      durationSec?: number;
      routingMode?: 'auto' | 'manual';
      selectedModelId?: string;
      genre?: string;
      style?: string;
    }) => {
      return trpcClient.audio.generate.mutate({
        prompt: input.prompt,
        mode: input.mode || 'text_to_music',
        durationSec: input.durationSec || 15,
        routingMode: input.routingMode || 'auto',
        selectedModelId: input.selectedModelId,
        entityId,
        universeId,
        genre: input.genre,
        style: input.style,
      });
    },
    onSuccess: (data) => {
      invalidateBalance();
      toast.success(`Music generated with ${data.modelName}!`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Music generation failed';
      toast.error(message);
    },
  });

  // High-level generate function with credit check
  const generateMusic = useCallback(
    async (input: {
      prompt: string;
      mode?: AudioMode;
      durationSec?: number;
      routingMode?: 'auto' | 'manual';
      selectedModelId?: string;
      genre?: string;
      style?: string;
    }) => {
      if (!checkCredits('music_standard')) return null;

      setIsGenerating(true);
      try {
        const result = await generateMutation.mutateAsync(input);
        return result;
      } finally {
        setIsGenerating(false);
      }
    },
    [generateMutation, checkCredits]
  );

  // Fetch generation history
  const { data: history = [] } = useQuery({
    ...trpc.audio.history.queryOptions({ limit: 20, entityId }),
    enabled: !!entityId,
  });

  return {
    models: models as AudioModel[],
    isGenerating,
    generateMusic,
    generateMutation,
    estimateCost,
    history,
    invalidateBalance,
  };
}

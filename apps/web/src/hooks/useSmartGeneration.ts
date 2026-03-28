/**
 * Smart Generation Hook
 *
 * Unified video generation hook that supports both Smart Auto routing
 * and Manual model selection through the new generation.generate endpoint.
 * Replaces per-model mutation logic with a single routed call.
 */
import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import type { RoutingMode } from '@/components/ModelSelector';

export interface StatusMessage {
  type: 'error' | 'success' | 'info' | 'warning';
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface UseSmartGenerationProps {
  prompt: string;
  durationSec: number;
  resolution: string;
  aspectRatio: string;
  audio: boolean;
  routingMode: RoutingMode;
  selectedModelId: string | null;
  allowFallback: boolean;
  universeId?: string;
  negativePrompt?: string;
  motionStrength?: number;
  cfgScale?: number;
  enablePromptExpansion?: boolean;
  setGeneratedVideoUrl: (url: string | null) => void;
  setStatusMessage: (message: StatusMessage | null) => void;
}

export interface SmartGenerationResult {
  generationId: string;
  status: 'completed';
  videoUrl: string;
  modelUsed: string;
  modelDisplayName: string;
  routingMode: RoutingMode;
  reasonCode: string;
  creditsCharged: number;
  fiatPriceUsd: number;
  wasFallback: boolean;
}

export function useSmartGeneration({
  prompt,
  durationSec,
  resolution,
  aspectRatio,
  audio,
  routingMode,
  selectedModelId,
  allowFallback,
  universeId,
  negativePrompt,
  motionStrength,
  cfgScale,
  enablePromptExpansion,
  setGeneratedVideoUrl,
  setStatusMessage,
}: UseSmartGenerationProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const generateMutation = useMutation({
    mutationFn: async ({
      imageUrl,
      overridePrompt,
    }: {
      imageUrl?: string;
      overridePrompt?: string;
    }) => {
      const mode = imageUrl ? 'image_to_video' : 'text_to_video';
      const finalPrompt = overridePrompt || prompt;

      return trpcClient.generation.generate.mutate({
        prompt: finalPrompt,
        imageUrl,
        mode,
        durationSec,
        resolution,
        aspectRatio,
        audio,
        routingMode,
        selectedModelId: routingMode === 'manual' ? selectedModelId || undefined : undefined,
        allowFallback,
        universeId,
        negativePrompt: negativePrompt || undefined,
        motionStrength,
        cfgScale,
        enablePromptExpansion,
      });
    },
    onSuccess: (data) => {
      if (data.videoUrl) {
        setGeneratedVideoUrl(data.videoUrl);

        const modelInfo = data.modelDisplayName || data.modelUsed;
        const fallbackNote = data.wasFallback ? ' (fallback model used)' : '';

        setStatusMessage({
          type: 'success',
          title: 'Video Generated!',
          description: `Created with ${modelInfo}${fallbackNote}. Cost: ${data.creditsCharged} credits`,
        });
      }
    },
    onError: (error) => {
      console.error('Smart generation error:', error);

      let title = 'Generation Failed';
      let description = error instanceof Error ? error.message : 'Failed to generate video';

      // Enrich error messages
      if (description.includes('Cannot use selected model')) {
        title = 'Model Unavailable';
      } else if (description.includes('content checker') || description.includes('flagged')) {
        title = 'Content Check Failed';
        description +=
          '\n\nTry using Smart Auto mode which can automatically fallback to a compatible model.';
      } else if (description.includes('quota') || description.includes('limit')) {
        title = 'API Limit Reached';
      }

      setStatusMessage({ type: 'error', title, description });
    },
  });

  const handleGenerate = useCallback(
    async (generatedImageUrl: string | null, uploadedUrl: string | null) => {
      setStatusMessage(null);
      setIsGenerating(true);

      try {
        const imageUrl = uploadedUrl || generatedImageUrl || undefined;
        const mode = imageUrl ? 'image-to-video' : 'text-to-video';

        setStatusMessage({
          type: 'info',
          title: 'Generating Video',
          description:
            routingMode === 'auto'
              ? `Smart Auto is selecting the best model for ${mode}...`
              : `Generating with selected model...`,
        });

        await generateMutation.mutateAsync({ imageUrl });
      } catch {
        // Error handled in mutation onError
      } finally {
        setIsGenerating(false);
      }
    },
    [prompt, generateMutation, routingMode, setStatusMessage, setGeneratedVideoUrl]
  );

  return {
    isGenerating,
    handleGenerate,
    generateMutation,
  };
}

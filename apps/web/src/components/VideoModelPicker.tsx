/**
 * VideoModelPicker — Drop-in replacement for the old hardcoded model buttons.
 *
 * Bridges the new ModelSelector (Smart Auto + Manual) to the legacy
 * selectedVideoModel/setSelectedVideoModel state used in universe pages.
 * Shows cost estimate and credit balance inline.
 */
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { ModelSelector, type RoutingMode } from './ModelSelector';

// Legacy model ID mapping (old hook IDs → new registry IDs)
const LEGACY_TO_REGISTRY: Record<string, string> = {
  'fal-veo3': 'veo31-i2v',
  'fal-kling': 'kling-i2v',
  'fal-wan25': 'wan25-i2v',
  'fal-sora': 'sora2-i2v',
};

const REGISTRY_TO_LEGACY: Record<string, string> = {
  'veo31-i2v': 'fal-veo3',
  'veo31-t2v': 'fal-veo3',
  'kling-i2v': 'fal-kling',
  'kling-t2v': 'fal-kling',
  'wan25-i2v': 'fal-wan25',
  'wan25-t2v': 'fal-wan25',
  'sora2-i2v': 'fal-sora',
  'sora2-t2v': 'fal-sora',
};

export type LegacyVideoModel = 'fal-veo3' | 'fal-kling' | 'fal-wan25' | 'fal-sora';

interface VideoModelPickerProps {
  /** Whether we have an image (image-to-video) or not (text-to-video) */
  hasImage: boolean;
  /** Legacy model state from parent */
  selectedVideoModel: LegacyVideoModel;
  setSelectedVideoModel: (model: LegacyVideoModel) => void;
  /** Optional: duration for cost estimate */
  durationSec?: number;
  /** Optional: resolution for cost estimate */
  resolution?: string;
}

export function VideoModelPicker({
  hasImage,
  selectedVideoModel,
  setSelectedVideoModel,
  durationSec = 5,
  resolution = '720p',
}: VideoModelPickerProps) {
  const mode = hasImage ? 'image_to_video' : 'text_to_video';
  const [routingMode, setRoutingMode] = useState<RoutingMode>('auto');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // Fetch credit balance
  const { data: balance } = useQuery({
    queryKey: ['creditBalance'],
    queryFn: () => trpcClient.credits.getBalance.query(),
  });

  // When user selects a model in ModelSelector, map back to legacy ID
  useEffect(() => {
    if (routingMode === 'manual' && selectedModelId) {
      const legacyId = REGISTRY_TO_LEGACY[selectedModelId];
      if (legacyId) {
        setSelectedVideoModel(legacyId as LegacyVideoModel);
      }
    }
  }, [selectedModelId, routingMode, setSelectedVideoModel]);

  // Sync legacy selection to ModelSelector on mount
  useEffect(() => {
    if (routingMode === 'manual') {
      const registryId = LEGACY_TO_REGISTRY[selectedVideoModel];
      if (registryId && registryId !== selectedModelId) {
        setSelectedModelId(registryId);
      }
    }
  }, [selectedVideoModel, routingMode]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Video Model</label>
        {balance && (
          <span className="text-xs text-zinc-400">
            Balance: <span className="text-amber-400 font-bold">{balance.balance}</span> credits
          </span>
        )}
      </div>

      <ModelSelector
        mode={mode as any}
        routingMode={routingMode}
        selectedModelId={selectedModelId}
        onRoutingModeChange={setRoutingMode}
        onModelSelect={setSelectedModelId}
        durationSec={durationSec}
        resolution={resolution}
      />

      {routingMode === 'auto' && (
        <p className="text-[10px] text-zinc-500">
          Smart Auto will pick the best model for your settings. Credits deducted on generation.
        </p>
      )}
    </div>
  );
}

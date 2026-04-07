/**
 * ModelSelector — Smart Auto / Manual model picker for video generation.
 *
 * Default: Smart Auto (platform picks best model).
 * Advanced: User can manually select a specific model.
 * Shows $LOAR token cost estimate, quality/speed/price badges.
 */
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

// ── Types ─────────────────────────────────────────────────────────────

export interface VideoModelInfo {
  id: string;
  provider: string;
  displayName: string;
  shortDescription: string;
  mode: string[];
  qualityTier: 'draft' | 'standard' | 'premium';
  speedTier: 'fast' | 'medium' | 'slow';
  priceTier: 'low' | 'medium' | 'high';
  supportsAudio: boolean;
  supports1080p: boolean;
  maxDurationSec: number;
  supportedDurations: number[];
  supportedAspectRatios: string[];
  creditCost: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  tags: string[];
  bestFor: string;
}

export type RoutingMode = 'auto' | 'manual';

export interface ModelSelectorProps {
  mode: 'text_to_video' | 'image_to_video';
  routingMode: RoutingMode;
  selectedModelId: string | null;
  onRoutingModeChange: (mode: RoutingMode) => void;
  onModelSelect: (modelId: string | null) => void;
  durationSec?: number;
  resolution?: string;
  audio?: boolean;
}

// ── Badge Components ──────────────────────────────────────────────────

const tierColors = {
  quality: { draft: 'bg-gray-600', standard: 'bg-blue-600', premium: 'bg-purple-600' },
  speed: { fast: 'bg-green-600', medium: 'bg-yellow-600', slow: 'bg-orange-600' },
  price: { low: 'bg-green-600', medium: 'bg-yellow-600', high: 'bg-red-600' },
} as const;

function Badge({
  label,
  tier,
  type,
}: {
  label: string;
  tier: string;
  type: 'quality' | 'speed' | 'price';
}) {
  const color = (tierColors[type] as any)[tier] || 'bg-gray-500';
  return (
    <span className={`${color} text-white text-[10px] px-1.5 py-0.5 rounded font-medium uppercase`}>
      {label}
    </span>
  );
}

// ── Cost Estimate Display ─────────────────────────────────────────────

function CostEstimate({
  mode,
  routingMode,
  selectedModelId,
  durationSec,
  resolution,
  audio,
}: {
  mode: string;
  routingMode: RoutingMode;
  selectedModelId: string | null;
  durationSec: number;
  resolution: string;
  audio: boolean;
}) {
  const { data: estimate } = useQuery({
    queryKey: ['costEstimate', routingMode, selectedModelId, mode, durationSec, resolution, audio],
    queryFn: () =>
      trpcClient.generation.estimateCost.query({
        routingMode,
        selectedModelId: selectedModelId || undefined,
        mode: mode as any,
        durationSec,
        resolution,
        audio,
      }),
    enabled: true,
  });

  if (!estimate) return null;

  return (
    <div className="flex items-center gap-2 text-xs mt-2">
      <span className="text-zinc-400">Estimated:</span>
      <span className="text-amber-400 font-bold">{estimate.credits} credits</span>
      {estimate.priceTier === 'high' && <span className="text-red-400 text-[10px]">Premium</span>}
    </div>
  );
}

// ── Model Card ────────────────────────────────────────────────────────

function ModelCard({
  model,
  isSelected,
  onClick,
}: {
  model: VideoModelInfo;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        isSelected
          ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
          : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500 hover:bg-zinc-800'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">{model.displayName}</span>
            {model.supportsAudio && <span className="text-[10px] text-zinc-400">+ Audio</span>}
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">{model.bestFor}</p>
        </div>
        <span className="text-amber-400 text-xs font-bold whitespace-nowrap">
          {model.creditCost} credits
        </span>
      </div>
      <div className="flex gap-1.5 mt-2">
        <Badge label={model.qualityTier} tier={model.qualityTier} type="quality" />
        <Badge label={model.speedTier} tier={model.speedTier} type="speed" />
        <Badge label={model.priceTier} tier={model.priceTier} type="price" />
        {model.supports1080p && <span className="text-[10px] text-zinc-500 px-1">1080p</span>}
      </div>
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────

export function ModelSelector({
  mode,
  routingMode,
  selectedModelId,
  onRoutingModeChange,
  onModelSelect,
  durationSec = 5,
  resolution = '720p',
  audio = false,
}: ModelSelectorProps) {
  const [showAdvanced, setShowAdvanced] = useState(routingMode === 'manual');

  // Fetch available models
  const { data: models, isLoading } = useQuery({
    queryKey: ['videoModels', mode],
    queryFn: () => trpcClient.generation.listModels.query({ mode }),
  });

  // When switching to auto, clear manual selection
  useEffect(() => {
    if (routingMode === 'auto') {
      onModelSelect(null);
    }
  }, [routingMode, onModelSelect]);

  return (
    <div className="space-y-3">
      {/* Smart Auto Toggle */}
      <div
        className={`p-3 rounded-lg border cursor-pointer transition-all ${
          routingMode === 'auto'
            ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
            : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
        }`}
        onClick={() => {
          onRoutingModeChange('auto');
          setShowAdvanced(false);
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
              routingMode === 'auto' ? 'border-amber-500' : 'border-zinc-500'
            }`}
          >
            {routingMode === 'auto' && <div className="w-2 h-2 rounded-full bg-amber-500" />}
          </div>
          <div>
            <span className="text-sm font-medium text-white">Smart Auto</span>
            <span className="text-xs text-zinc-400 ml-2">Recommended</span>
          </div>
        </div>
        <p className="text-xs text-zinc-400 mt-1 ml-6">
          Best balance of quality, speed, and cost. Platform optimizes automatically.
        </p>
      </div>

      {/* Advanced Toggle */}
      <button
        onClick={() => {
          const nextShow = !showAdvanced;
          setShowAdvanced(nextShow);
          if (nextShow) {
            onRoutingModeChange('manual');
          } else {
            onRoutingModeChange('auto');
          }
        }}
        className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Use a specific model
      </button>

      {/* Manual Model List */}
      {showAdvanced && (
        <div className="space-y-2 pl-2">
          {isLoading ? (
            <div className="text-xs text-zinc-500 py-4 text-center">Loading models...</div>
          ) : (
            <>
              {models?.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model as VideoModelInfo}
                  isSelected={selectedModelId === model.id}
                  onClick={() => onModelSelect(model.id)}
                />
              ))}
              {(!models || models.length === 0) && (
                <p className="text-xs text-zinc-500 py-2">
                  No models available for {mode.replace('_', '-')}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Cost Estimate */}
      <CostEstimate
        mode={mode}
        routingMode={routingMode}
        selectedModelId={selectedModelId}
        durationSec={durationSec}
        resolution={resolution}
        audio={audio}
      />
    </div>
  );
}

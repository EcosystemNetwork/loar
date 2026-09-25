import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { MODEL_REGISTRY_MAP } from '@/components/sandbox/constants';
import type { VideoModel } from '@/types/sandbox.types';

export interface CostEstimate {
  modelName: string;
  /** Platform price for one generation (one image, or one video), in USD. */
  unitUsd: number;
}

const STALE_MS = 5 * 60_000;

/** Registry price of the selected video model (generation.estimateCost). */
export function useVideoCostEstimate(p: {
  videoModel: VideoModel;
  animate: boolean;
  durationSec: number;
  resolution: string;
  audio: boolean;
}): CostEstimate | null {
  const ids = MODEL_REGISTRY_MAP[p.videoModel];
  const selectedModelId = p.animate ? ids.i2v : ids.t2v;
  const { data } = useQuery({
    queryKey: [
      'generation.estimateCost',
      selectedModelId,
      p.animate,
      p.durationSec,
      p.resolution,
      p.audio,
    ],
    queryFn: () =>
      trpcClient.generation.estimateCost.query({
        routingMode: 'manual',
        selectedModelId,
        mode: p.animate ? 'image_to_video' : 'text_to_video',
        durationSec: p.durationSec,
        resolution: p.resolution,
        audio: p.audio,
      }),
    staleTime: STALE_MS,
  });
  // An unknown model comes back as a zeroed "Unknown" row — don't advertise that as free.
  if (!data || data.modelName === 'Unknown') return null;
  return { modelName: data.modelName, unitUsd: data.fiatPriceUsd };
}

/** Price of ONE image for the selected model (or the auto-routed pick when none is chosen). */
export function useImageCostEstimate(p: {
  imageModel: string;
  styleRef: boolean;
}): CostEstimate | null {
  const manual = !!p.imageModel;
  const task = p.styleRef ? 'image_to_image' : 'text_to_image';
  const { data } = useQuery({
    queryKey: ['image.estimateCost', manual ? p.imageModel : 'auto', task],
    queryFn: () =>
      trpcClient.image.estimateCost.query({
        task,
        numImages: 1,
        routingMode: manual ? 'manual' : 'auto',
        ...(manual ? { selectedModelId: p.imageModel } : {}),
      }),
    staleTime: STALE_MS,
  });
  if (!data || data.modelName === 'Unknown') return null;
  return { modelName: data.modelName, unitUsd: data.fiatPriceUsd };
}

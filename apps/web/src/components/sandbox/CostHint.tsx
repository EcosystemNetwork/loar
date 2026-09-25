import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { MODEL_REGISTRY_MAP } from '@/components/sandbox/constants';
import type { VideoModel } from '@/types/sandbox.types';

function formatUsd(usd: number): string {
  if (usd <= 0) return 'Free';
  return usd < 0.1 ? `~$${usd.toFixed(3)}` : `~$${usd.toFixed(2)}`;
}

/**
 * Shows the platform price of the selected video model before the user submits,
 * from the same registry the server charges against (generation.estimateCost).
 * Renders nothing until the estimate loads or if it can't be resolved.
 */
export function VideoCostHint({
  videoModel,
  animate,
  durationSec,
  resolution,
  audio,
}: {
  videoModel: VideoModel;
  animate: boolean;
  durationSec: number;
  resolution: string;
  audio: boolean;
}) {
  const ids = MODEL_REGISTRY_MAP[videoModel];
  const selectedModelId = animate ? ids.i2v : ids.t2v;
  const { data } = useQuery({
    queryKey: ['generation.estimateCost', selectedModelId, animate, durationSec, resolution, audio],
    queryFn: () =>
      trpcClient.generation.estimateCost.query({
        routingMode: 'manual',
        selectedModelId,
        mode: animate ? 'image_to_video' : 'text_to_video',
        durationSec,
        resolution,
        audio,
      }),
    staleTime: 5 * 60_000,
  });

  // Unknown model comes back as a zeroed "Unknown" row — don't advertise that as free.
  if (!data || data.modelName === 'Unknown') return null;

  return (
    <p className="text-[11px] text-muted-foreground -mt-1" data-testid="video-cost-hint">
      Video with {data.modelName}: {formatUsd(data.fiatPriceUsd)} per generation
    </p>
  );
}

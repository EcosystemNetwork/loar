import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Generation } from '@/types/sandbox.types';
import { estimateProgress, formatEta, getLatencyStats, latencyKey } from '@/lib/generation-latency';

/**
 * In-flight indicator for a generation. Uses this device's recorded latency for
 * the model to draw a progress bar + ETA; with too little history it stays a
 * plain spinner instead of guessing.
 */
export function GenerationProgress({ gen, onCancel }: { gen: Generation; onCancel?: () => void }) {
  const stats = useMemo(
    () => getLatencyStats(latencyKey(gen)),
    // Stats only need to be read once per run; the key inputs are fixed at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gen.id]
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!stats) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stats]);

  const progress = stats ? estimateProgress(now - gen.createdAt, stats) : null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <span className="text-xs text-muted-foreground">Generating {gen.kind}…</span>
      {progress && (
        <>
          <div
            className="h-1 w-full max-w-[160px] overflow-hidden rounded-full bg-muted-foreground/20"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.fraction * 100)}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
              style={{ width: `${progress.fraction * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">
            {progress.overdue
              ? 'Taking longer than usual…'
              : progress.etaMs > 0
                ? `~${formatEta(progress.etaMs)} left`
                : 'Almost there…'}
          </span>
        </>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-1 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

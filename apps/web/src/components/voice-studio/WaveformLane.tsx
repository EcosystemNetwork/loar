/**
 * WaveformLane — one horizontal lane of waveform regions.
 *
 * Each region is a clip placed at its startSec. wavesurfer.js renders the
 * waveform; the parent positions the region absolutely on the timeline scale.
 *
 * This is a thin presentation component — no state. The parent
 * MultiTrackEditor owns the project, timing decisions, and region operations.
 */

import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { cn } from '@/lib/utils';

export interface LaneRegion {
  id: string;
  audioUrl: string;
  startSec: number;
  durationSec: number;
  label?: string;
  status?: 'pending' | 'generating' | 'ready' | 'failed';
}

interface WaveformLaneProps {
  laneLabel: string;
  color: string; // tailwind utility, e.g., 'bg-sky-500/30'
  regions: LaneRegion[];
  pxPerSec: number;
  totalDurationSec: number;
  selectedRegionId?: string;
  onSelectRegion?: (id: string) => void;
}

export function WaveformLane({
  laneLabel,
  color,
  regions,
  pxPerSec,
  totalDurationSec,
  selectedRegionId,
  onSelectRegion,
}: WaveformLaneProps) {
  return (
    <div className="flex">
      <div className="w-28 shrink-0 truncate border-r border-border bg-card/50 px-2 py-2 text-xs font-medium">
        {laneLabel}
      </div>
      <div
        className="relative h-16 grow overflow-x-auto border-b border-border bg-background"
        style={{ minWidth: Math.max(totalDurationSec * pxPerSec, 400) }}
      >
        {regions.map((r) => (
          <RegionView
            key={r.id}
            region={r}
            pxPerSec={pxPerSec}
            color={color}
            selected={selectedRegionId === r.id}
            onSelect={onSelectRegion}
          />
        ))}
      </div>
    </div>
  );
}

function RegionView({
  region,
  pxPerSec,
  color,
  selected,
  onSelect,
}: {
  region: LaneRegion;
  pxPerSec: number;
  color: string;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url: region.audioUrl,
      height: 44,
      waveColor: 'rgba(255,255,255,0.6)',
      progressColor: 'rgba(255,255,255,0.9)',
      cursorWidth: 0,
      interact: false,
      normalize: true,
    });
    wsRef.current = ws;
    return () => {
      try {
        ws.destroy();
      } catch {
        /* noop */
      }
    };
  }, [region.audioUrl]);

  const width = Math.max(20, region.durationSec * pxPerSec);
  const left = region.startSec * pxPerSec;

  return (
    <div
      className={cn(
        'absolute top-1 cursor-pointer rounded border transition-shadow',
        color,
        selected ? 'border-primary ring-2 ring-primary' : 'border-border/40',
        region.status === 'failed' ? 'opacity-50' : ''
      )}
      style={{ left, width, height: 56 }}
      onClick={() => onSelect?.(region.id)}
      title={region.label}
    >
      <div ref={containerRef} className="h-11 w-full" />
      <div className="truncate px-1 text-[10px] text-foreground/80">{region.label}</div>
    </div>
  );
}

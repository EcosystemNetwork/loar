/**
 * Sparkline — tiny inline price chart (area + line) with an up/down colour cue.
 * Shared by the launchpad card grid and the dense table view.
 */
import { memo, useState } from 'react';

let sparklineIdCounter = 0;

export const Sparkline = memo(function Sparkline({
  data,
  width = 80,
  height = 32,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  const [gradientId] = useState(() => `spark-${++sparklineIdCounter}`);

  if (data.length < 2) return <div style={{ width, height }} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const isPositive = data[data.length - 1] >= data[0];
  const color = isPositive ? '#22c55e' : '#ef4444';

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${gradientId})`} points={areaPoints} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
});

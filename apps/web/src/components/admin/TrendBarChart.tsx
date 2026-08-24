/**
 * Generic single-series daily trend, rendered as inline SVG bars — no chart
 * library dependency, same approach as CostTrendChart. Used for signups,
 * daily active users, and any other "count per day" admin metric.
 * Single series (magnitude), so no legend box; native <title> hover gives
 * the per-bar tooltip.
 */

import { useMemo } from 'react';

export interface TrendBarPoint {
  day: string;
  value: number;
}

export interface TrendBarChartProps {
  series: TrendBarPoint[];
  /** Formats the hover tooltip and axis max, e.g. (n) => `${n} new users` */
  formatValue?: (n: number) => string;
}

const PAD = { top: 16, right: 16, bottom: 24, left: 32 };

export function TrendBarChart({ series, formatValue = (n) => String(n) }: TrendBarChartProps) {
  const { bars, axes, maxValue, width, height } = useMemo(() => {
    const W = 720;
    const H = 180;
    const n = Math.max(series.length, 1);
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const max = Math.max(1, ...series.map((p) => p.value));

    const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const barW = n === 1 ? 8 : Math.max(2, plotW / n - 1);

    const bars = series.map((p, i) => {
      const h = (p.value / max) * plotH;
      return {
        x: x(i) - barW / 2,
        y: PAD.top + (plotH - h),
        w: barW,
        h,
        day: p.day,
        value: p.value,
      };
    });

    return {
      bars,
      axes: {
        bottom: H - PAD.bottom,
        firstX: PAD.left,
        lastX: PAD.left + plotW,
        firstLabel: series[0]?.day.slice(5) ?? '',
        midLabel: series[Math.floor(series.length / 2)]?.day.slice(5) ?? '',
        lastLabel: series[series.length - 1]?.day.slice(5) ?? '',
      },
      maxValue: max,
      width: W,
      height: H,
    };
  }, [series]);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[560px]"
        role="img"
        aria-label="Daily trend"
      >
        <g fontSize="10" className="fill-muted-foreground">
          <text x={2} y={PAD.top + 4}>
            {maxValue}
          </text>
          <text x={2} y={height - PAD.bottom}>
            0
          </text>
        </g>

        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={1} className="fill-primary/50">
            <title>{`${b.day}: ${formatValue(b.value)}`}</title>
          </rect>
        ))}

        <g fontSize="10" className="fill-muted-foreground">
          <text x={axes.firstX} y={axes.bottom + 14}>
            {axes.firstLabel}
          </text>
          <text x={(axes.firstX + axes.lastX) / 2} y={axes.bottom + 14} textAnchor="middle">
            {axes.midLabel}
          </text>
          <text x={axes.lastX} y={axes.bottom + 14} textAnchor="end">
            {axes.lastLabel}
          </text>
        </g>
      </svg>
    </div>
  );
}

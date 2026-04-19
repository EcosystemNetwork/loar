/**
 * 30-day margin + cost trend chart, rendered as inline SVG — no chart
 * library dependency. Two overlaid series:
 *   - bar: daily cost
 *   - line: daily margin ratio (target line at 0.30 marked)
 */

import { useMemo } from 'react';

export interface TrendPoint {
  day: string;
  costUsd: number;
  revenueUsd: number;
  marginRatio: number;
  calls: number;
}

export interface CostTrendChartProps {
  series: TrendPoint[];
  target: number;
}

const PAD = { top: 16, right: 36, bottom: 24, left: 40 };

export function CostTrendChart({ series, target }: CostTrendChartProps) {
  const { path, bars, axes, maxCost, pts, targetY, width, height } = useMemo(() => {
    const W = 720;
    const H = 200;
    const n = Math.max(series.length, 1);
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const max = Math.max(1, ...series.map((p) => p.costUsd));

    const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const barW = n === 1 ? 8 : Math.max(2, plotW / n - 1);

    const bars = series.map((p, i) => {
      const h = (p.costUsd / max) * plotH;
      return {
        x: x(i) - barW / 2,
        y: PAD.top + (plotH - h),
        w: barW,
        h,
        day: p.day,
        costUsd: p.costUsd,
      };
    });

    const marginToY = (m: number) => {
      const clamped = Math.max(-0.5, Math.min(1, m));
      return PAD.top + (1 - clamped) * plotH;
    };
    const pts = series.map((p, i) => ({ x: x(i), y: marginToY(p.marginRatio), p }));
    const path = pts.length
      ? pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')
      : '';

    return {
      path,
      bars,
      axes: {
        bottom: H - PAD.bottom,
        firstX: PAD.left,
        lastX: PAD.left + plotW,
        firstLabel: series[0]?.day.slice(5) ?? '',
        midLabel: series[Math.floor(series.length / 2)]?.day.slice(5) ?? '',
        lastLabel: series[series.length - 1]?.day.slice(5) ?? '',
      },
      maxCost: max,
      pts,
      targetY: marginToY(target),
      width: W,
      height: H,
    };
  }, [series, target]);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[640px]"
        role="img"
        aria-label="30-day cost and margin trend"
      >
        {/* Y-axis labels — cost (left), margin (right) */}
        <g fontSize="10" className="fill-muted-foreground">
          <text x={4} y={PAD.top + 4}>
            ${maxCost.toFixed(0)}
          </text>
          <text x={4} y={height - PAD.bottom}>
            $0
          </text>
          <text x={width - 30} y={PAD.top + 4}>
            100%
          </text>
          <text x={width - 30} y={targetY + 3}>
            {(target * 100).toFixed(0)}%
          </text>
          <text x={width - 30} y={height - PAD.bottom}>
            0%
          </text>
        </g>

        {/* Target margin line */}
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={targetY}
          y2={targetY}
          stroke="#10b981"
          strokeDasharray="3 3"
          strokeWidth={1}
          opacity={0.7}
        />

        {/* Cost bars */}
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} className="fill-primary/40">
            <title>{`${b.day}: $${b.costUsd.toFixed(2)} cost`}</title>
          </rect>
        ))}

        {/* Margin line */}
        {path ? <path d={path} stroke="#f43f5e" fill="none" strokeWidth={1.5} /> : null}
        {pts.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r={2.5} className="fill-rose-400">
            <title>{`${pt.p.day}: ${(pt.p.marginRatio * 100).toFixed(1)}% margin`}</title>
          </circle>
        ))}

        {/* X-axis labels (first, mid, last) */}
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
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground mt-1 px-2">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 bg-primary/40" /> daily cost
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-[1px] bg-rose-400" /> margin %
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 border-t border-dashed border-emerald-500" /> target{' '}
          {(target * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

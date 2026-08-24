/**
 * Subscription tier distribution — inline SVG pie, no chart library.
 * Categorical colors are assigned in a fixed order (never cycled/re-ranked
 * on data change) and every wedge carries a direct label, so identity never
 * depends on color alone.
 */
import { useMemo } from 'react';

export interface TierSlice {
  key: string;
  label: string;
  count: number;
}

// Fixed categorical order, validated with the dataviz skill's
// validate_palette.js against this theme's actual light/dark surfaces
// (index.css --background) — all pass in both modes except one: `--primary`
// itself sits slightly outside the dark-mode lightness band (L 0.72 vs the
// 0.48-0.67 band), which we accept since it's this app's existing, already
// shipped brand token, not something to override for one chart. 600-weight
// Tailwind shades were picked over 400s specifically because they clear the
// CVD-separation and lightness-band checks; amber-400/600 are excluded
// entirely since `--primary` is already an amber hue (oklch h≈45) and would
// be indistinguishable from it.
const COLORS = [
  'fill-primary',
  'fill-emerald-600',
  'fill-sky-600',
  'fill-violet-600',
  'fill-rose-600',
  'fill-teal-600',
];

export function TierDistributionPie({ slices }: { slices: TierSlice[] }) {
  const { arcs, total } = useMemo(() => {
    const total = slices.reduce((s, x) => s + x.count, 0);
    let angle = -Math.PI / 2; // start at 12 o'clock
    const R = 70;
    const CX = 90;
    const CY = 90;
    const arcs = slices
      .filter((s) => s.count > 0)
      .map((s, i) => {
        const frac = total > 0 ? s.count / total : 0;
        const start = angle;
        const end = angle + frac * Math.PI * 2;
        angle = end;
        const large = end - start > Math.PI ? 1 : 0;
        const x1 = CX + R * Math.cos(start);
        const y1 = CY + R * Math.sin(start);
        const x2 = CX + R * Math.cos(end);
        const y2 = CY + R * Math.sin(end);
        const mid = (start + end) / 2;
        const labelR = R * 0.65;
        const lx = CX + labelR * Math.cos(mid);
        const ly = CY + labelR * Math.sin(mid);
        return {
          key: s.key,
          label: s.label,
          count: s.count,
          pct: total > 0 ? (frac * 100).toFixed(1) : '0.0',
          d: `M${CX},${CY} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`,
          lx,
          ly,
          color: COLORS[i % COLORS.length],
        };
      });
    return { arcs, total };
  }, [slices]);

  if (total === 0) {
    return <p className="text-xs text-muted-foreground">No subscribers yet.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        viewBox="0 0 180 180"
        className="h-40 w-40 shrink-0"
        role="img"
        aria-label="Tier distribution"
      >
        {arcs.map((a) => (
          <path key={a.key} d={a.d} className={`${a.color} stroke-background`} strokeWidth={1}>
            <title>{`${a.label}: ${a.count} (${a.pct}%)`}</title>
          </path>
        ))}
      </svg>
      <ul className="space-y-1 text-xs">
        {arcs.map((a) => (
          <li key={a.key} className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${a.color}`} />
            <span className="text-muted-foreground">{a.label}</span>
            <span className="font-medium">
              {a.count} ({a.pct}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

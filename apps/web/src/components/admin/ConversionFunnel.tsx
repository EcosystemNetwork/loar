/**
 * Site-wide conversion funnel — horizontal bars, each stage's width scaled
 * to the first stage. Plain HTML/CSS, no chart library.
 */

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export function ConversionFunnel({ stages }: { stages: FunnelStage[] }) {
  const base = stages[0]?.count || 1;
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const pct = base > 0 ? (s.count / base) * 100 : 0;
        const prev = i > 0 ? stages[i - 1].count : null;
        const fromPrev = prev && prev > 0 ? (s.count / prev) * 100 : null;
        return (
          <div key={s.key}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium">
                {s.count.toLocaleString()} ({pct.toFixed(1)}%)
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-sm bg-muted">
              <div
                className="h-full rounded-sm bg-primary/60"
                style={{ width: `${Math.max(pct, s.count > 0 ? 1 : 0)}%` }}
              />
            </div>
            {fromPrev != null ? (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {fromPrev.toFixed(1)}% of previous stage
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

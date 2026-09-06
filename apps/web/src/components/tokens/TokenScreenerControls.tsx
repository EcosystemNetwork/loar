/**
 * TokenScreenerControls — preset chips + a collapsible advanced-filter panel
 * for the launchpad. Pure controlled component; the launchpad owns the state.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  type AdvancedFilters,
  EMPTY_FILTERS,
  activeFilterCount,
  SCREENER_PRESETS,
} from '@/lib/token-screener';

interface NumFieldSpec {
  key: keyof AdvancedFilters;
  label: string;
  suffix?: string;
  step?: string;
}

const NUM_FIELDS: NumFieldSpec[] = [
  { key: 'minMcap', label: 'Min MCap', suffix: 'ETH', step: '0.1' },
  { key: 'maxMcap', label: 'Max MCap', suffix: 'ETH', step: '0.1' },
  { key: 'minLiquidity', label: 'Min Liquidity', suffix: 'ETH', step: '0.1' },
  { key: 'minVolume24h', label: 'Min Vol 24h', suffix: 'ETH', step: '0.1' },
  { key: 'minHolders', label: 'Min Holders', step: '1' },
  { key: 'maxAgeHours', label: 'Max Age', suffix: 'h', step: '1' },
];

export function TokenScreenerControls({
  filters,
  onFiltersChange,
  activePreset,
  onPreset,
}: {
  filters: AdvancedFilters;
  onFiltersChange: (f: AdvancedFilters) => void;
  activePreset: string | null;
  onPreset: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(filters);

  const setNum = (key: keyof AdvancedFilters, raw: string) => {
    const v = raw.trim() === '' ? null : Number(raw);
    onFiltersChange({ ...filters, [key]: v == null || Number.isNaN(v) ? null : v });
  };

  return (
    <div className="space-y-2">
      {/* Preset chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SCREENER_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onPreset(activePreset === p.id ? null : p.id)}
            title={p.description}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activePreset === p.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background hover:bg-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
        <Button
          variant={open || count > 0 ? 'default' : 'outline'}
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-[11px]"
          onClick={() => setOpen((o) => !o)}
        >
          <SlidersHorizontal className="h-3 w-3" />
          Filters
          {count > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px] tabular-nums">
              {count}
            </Badge>
          )}
        </Button>
        {count > 0 && (
          <button
            onClick={() => {
              onFiltersChange(EMPTY_FILTERS);
              onPreset(null);
            }}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {/* Advanced panel */}
      {open && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
          {NUM_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              {f.label}
              <div className="relative">
                <Input
                  type="number"
                  inputMode="decimal"
                  step={f.step}
                  min="0"
                  value={filters[f.key] == null ? '' : String(filters[f.key])}
                  onChange={(e) => setNum(f.key, e.target.value)}
                  className="h-8 pr-9 text-xs"
                  placeholder="—"
                />
                {f.suffix && (
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">
                    {f.suffix}
                  </span>
                )}
              </div>
            </label>
          ))}
          <label className="col-span-2 flex items-center gap-2 text-[11px] sm:col-span-3">
            <input
              type="checkbox"
              checked={filters.onlyWithImage}
              onChange={(e) => onFiltersChange({ ...filters, onlyWithImage: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Only tokens with an image
          </label>
        </div>
      )}
    </div>
  );
}

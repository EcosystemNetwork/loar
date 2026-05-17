/**
 * StylePresetPicker
 *
 * Curated visual-style grid for AI image/video generation. Drop-in selector that
 * lets a creator pick a named cinematic look ("Anime", "Noir", "Studio Ghibli")
 * which the server augments into the prompt via applyStyleToPrompt().
 *
 * Grouped by category with a swatch + label. Click to toggle (re-clicking
 * the active preset clears it).
 */

import { useMemo, useState } from 'react';
import {
  STYLE_PRESETS,
  STYLE_CATEGORY_LABELS,
  type StylePresetCategory,
  type StylePresetId,
  type StylePresetDisplay,
} from './style-presets';

interface StylePresetPickerProps {
  value: StylePresetId | null;
  onChange: (next: StylePresetId | null) => void;
  disabled?: boolean;
  /** Compact rendering (fewer columns, smaller swatches). Default false. */
  compact?: boolean;
}

export function StylePresetPicker({ value, onChange, disabled, compact }: StylePresetPickerProps) {
  const [activeCategory, setActiveCategory] = useState<StylePresetCategory | 'all'>('all');

  const grouped = useMemo(() => {
    const map = new Map<StylePresetCategory, StylePresetDisplay[]>();
    for (const preset of STYLE_PRESETS) {
      const list = map.get(preset.category) ?? [];
      list.push(preset);
      map.set(preset.category, list);
    }
    return map;
  }, []);

  const categories = useMemo(() => Array.from(grouped.keys()) as StylePresetCategory[], [grouped]);

  const visible = useMemo(
    () => (activeCategory === 'all' ? STYLE_PRESETS : (grouped.get(activeCategory) ?? [])),
    [activeCategory, grouped]
  );

  const gridCols = compact ? 'grid-cols-3' : 'grid-cols-4 sm:grid-cols-5 md:grid-cols-6';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Visual Style</span>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>

      {/* Category filter chips */}
      <div className="flex gap-1 flex-wrap">
        <CategoryChip
          active={activeCategory === 'all'}
          onClick={() => setActiveCategory('all')}
          disabled={disabled}
        >
          All
        </CategoryChip>
        {categories.map((cat) => (
          <CategoryChip
            key={cat}
            active={activeCategory === cat}
            onClick={() => setActiveCategory(cat)}
            disabled={disabled}
          >
            {STYLE_CATEGORY_LABELS[cat]}
          </CategoryChip>
        ))}
      </div>

      {/* Style grid */}
      <div className={`grid gap-1.5 ${gridCols}`}>
        {visible.map((preset) => {
          const isActive = preset.id === value;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(isActive ? null : preset.id)}
              disabled={disabled}
              className={`group text-left rounded border transition-all overflow-hidden disabled:opacity-50 ${
                isActive ? 'border-2 shadow-sm' : 'border-border hover:border-primary/40'
              }`}
              style={{
                borderColor: isActive ? preset.color : undefined,
              }}
              title={preset.label}
            >
              <div
                className={compact ? 'h-6' : 'h-10'}
                style={{
                  background: `linear-gradient(135deg, ${preset.color}, ${preset.color}aa)`,
                }}
              />
              <div className="px-1.5 py-1 text-[10px] leading-tight truncate">{preset.label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background text-muted-foreground border-border hover:border-primary/40'
      }`}
    >
      {children}
    </button>
  );
}

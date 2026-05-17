/**
 * ShotPresetPicker
 *
 * Cinematographer's shot-grammar selector: framing / angle / lens / focus.
 * Sibling to StylePresetPicker but tuned for composition language — chips
 * grouped by axis (you typically pick one framing + one angle + maybe a lens).
 *
 * Currently single-select across all axes (one shotPreset per generation).
 * If you later want compositional stacking (framing AND angle AND lens),
 * promote the value to an array and let multi-axis combine prompt fragments.
 */

import { useMemo } from 'react';
import {
  SHOT_PRESETS,
  SHOT_CATEGORY_LABELS,
  type ShotPresetCategory,
  type ShotPresetId,
  type ShotPresetDisplay,
} from './shot-presets';

interface ShotPresetPickerProps {
  value: ShotPresetId | null;
  onChange: (next: ShotPresetId | null) => void;
  disabled?: boolean;
}

export function ShotPresetPicker({ value, onChange, disabled }: ShotPresetPickerProps) {
  const grouped = useMemo(() => {
    const map = new Map<ShotPresetCategory, ShotPresetDisplay[]>();
    for (const preset of SHOT_PRESETS) {
      const list = map.get(preset.category) ?? [];
      list.push(preset);
      map.set(preset.category, list);
    }
    return Array.from(map.entries()) as [ShotPresetCategory, ShotPresetDisplay[]][];
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Shot Grammar</span>
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

      <div className="space-y-2">
        {grouped.map(([category, presets]) => (
          <div key={category} className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              {SHOT_CATEGORY_LABELS[category]}
            </span>
            <div className="flex flex-wrap gap-1">
              {presets.map((preset) => {
                const isActive = preset.id === value;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChange(isActive ? null : preset.id)}
                    disabled={disabled}
                    title={preset.hint}
                    className={`text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                      isActive
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/40 text-foreground/80'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

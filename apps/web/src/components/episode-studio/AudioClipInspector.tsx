/**
 * AudioClipInspector — precise controls for the selected audio clip(s): name,
 * level, fades and looping. The lane's fade handles and headers cover quick
 * edits; this is for exact values (and works from the keyboard / on touch).
 *
 * With several clips selected, level / fades / loop apply to all of them.
 */
import { Repeat, Volume2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_FADE_SEC, type AudioClip } from '@/lib/audioMix';
import { Fader } from './AudioLanes';

interface AudioClipInspectorProps {
  clips: AudioClip[];
  onPatch: (
    patch: Partial<Pick<AudioClip, 'label' | 'volume' | 'fadeIn' | 'fadeOut' | 'loop'>>
  ) => void;
}

const same = <T,>(values: T[]): T | undefined =>
  values.every((v) => v === values[0]) ? values[0] : undefined;

export function AudioClipInspector({ clips, onPatch }: AudioClipInspectorProps) {
  if (clips.length === 0) return null;
  const single = clips.length === 1 ? clips[0] : null;
  const volume = same(clips.map((c) => c.volume));
  const fadeIn = same(clips.map((c) => c.fadeIn));
  const fadeOut = same(clips.map((c) => c.fadeOut));
  const loop = same(clips.map((c) => !!c.loop));
  const shortest = Math.min(...clips.map((c) => c.length));
  const maxFade = Math.min(MAX_FADE_SEC, shortest / 2);

  const seconds = (label: string, value: number | undefined, key: 'fadeIn' | 'fadeOut') => (
    <div className="space-y-1">
      <Label htmlFor={`audio-${key}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`audio-${key}`}
        type="number"
        min={0}
        max={maxFade}
        step={0.1}
        className="h-8"
        value={value === undefined ? '' : Number(value.toFixed(2))}
        placeholder={value === undefined ? 'mixed' : undefined}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onPatch({ [key]: n });
        }}
      />
    </div>
  );

  return (
    <section
      aria-label="Audio clip settings"
      className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-[1.4fr_1.6fr_1fr_1fr_auto]"
    >
      <div className="space-y-1">
        <Label htmlFor="audio-name" className="flex items-center gap-1 text-xs">
          <Volume2 className="h-3 w-3" />
          {single ? 'Audio clip' : `${clips.length} audio clips`}
        </Label>
        <Input
          id="audio-name"
          className="h-8"
          disabled={!single}
          maxLength={60}
          value={single ? single.label : ''}
          placeholder={single ? 'Name' : 'Multiple selected'}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Level {volume === undefined ? '(mixed)' : `${Math.round(volume * 100)}%`}
        </Label>
        <div className="flex h-8 items-center">
          <Fader label="Clip level" value={volume ?? 1} onCommit={(v) => onPatch({ volume: v })} />
        </div>
      </div>

      {seconds('Fade in (s)', fadeIn, 'fadeIn')}
      {seconds('Fade out (s)', fadeOut, 'fadeOut')}

      <label className="flex items-end gap-2 pb-1.5 text-xs">
        <Checkbox
          checked={loop === undefined ? 'indeterminate' : loop}
          onCheckedChange={(v) => onPatch({ loop: v === true })}
        />
        <span className="flex items-center gap-1">
          <Repeat className="h-3 w-3" /> Loop
        </span>
      </label>
    </section>
  );
}

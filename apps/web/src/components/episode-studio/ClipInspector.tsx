/**
 * ClipInspector — audio level and fades for the selected clip(s).
 *
 * Sliders hold a local draft while dragging and commit once on release, so a
 * single adjustment is one undo step instead of dozens.
 */
import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { MAX_FADE_SEC } from '@/lib/episodeCut';
import type { EpisodeClip } from './EpisodeClipTimeline';

interface ClipInspectorProps {
  /** The selected clips (non-empty). */
  clips: EpisodeClip[];
  /** Shortest selected clip, in seconds — caps the fades. */
  minLength: number;
  onPatch: (patch: Partial<Pick<EpisodeClip, 'volume' | 'fadeIn' | 'fadeOut'>>) => void;
}

function useDraft(value: number, commit: (v: number) => void) {
  const [draft, setDraft] = useState(value);
  // What was last sent up, so pointer-up followed by blur can't commit twice
  // before the parent's new value has flowed back in.
  const committed = useRef(value);
  useEffect(() => {
    setDraft(value);
    committed.current = value;
  }, [value]);
  return {
    draft,
    setDraft,
    /** Commit once (pointer up / key up / blur); a no-op when nothing changed. */
    settle: () => {
      if (draft === committed.current) return;
      committed.current = draft;
      commit(draft);
    },
  };
}

export function ClipInspector({ clips, minLength, onPatch }: ClipInspectorProps) {
  const first = clips[0];
  const volume = useDraft(first.volume ?? 1, (v) => onPatch({ volume: v }));
  const fadeMax = Math.max(0.1, Math.min(MAX_FADE_SEC, Math.floor((minLength / 2) * 10) / 10));
  const fadeIn = useDraft(first.fadeIn ?? 0, (v) => onPatch({ fadeIn: v }));
  const fadeOut = useDraft(first.fadeOut ?? 0, (v) => onPatch({ fadeOut: v }));
  const muted = (first.volume ?? 1) === 0;

  const row = (
    id: string,
    label: string,
    value: string,
    d: ReturnType<typeof useDraft>,
    max: number,
    step: number
  ) => (
    <div
      className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-3"
      onPointerUp={d.settle}
      onKeyUp={d.settle}
      onBlur={d.settle}
    >
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Slider
        id={id}
        min={0}
        max={max}
        step={step}
        value={[d.draft]}
        onValueChange={([v]) => d.setDraft(v)}
        aria-label={label}
      />
      <span className="text-right text-xs tabular-nums text-muted-foreground">{value}</span>
    </div>
  );

  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">
          Audio &amp; fades
          <span className="ml-1.5 font-normal text-muted-foreground">
            {clips.length > 1 ? `${clips.length} clips` : first.label || 'selected clip'}
          </span>
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => onPatch({ volume: muted ? 1 : 0 })}
          aria-pressed={muted}
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          {muted ? 'Unmute' : 'Mute'}
        </Button>
      </div>
      {row('clip-volume', 'Volume', `${Math.round(volume.draft * 100)}%`, volume, 2, 0.05)}
      {row('clip-fade-in', 'Fade in', `${fadeIn.draft.toFixed(1)}s`, fadeIn, fadeMax, 0.1)}
      {row('clip-fade-out', 'Fade out', `${fadeOut.draft.toFixed(1)}s`, fadeOut, fadeMax, 0.1)}
      <p className="text-[11px] text-muted-foreground">
        Fades go through black and silence. Volume above 100% boosts the export; the preview tops
        out at 100%.
      </p>
    </div>
  );
}

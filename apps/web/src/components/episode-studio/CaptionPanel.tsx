/**
 * CaptionPanel — edit the text overlays burned into the export.
 *
 * Text is held in a local draft and committed shortly after typing stops (and
 * on blur), so typing a sentence is one undo step, not one per keystroke.
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  MAX_OVERLAYS,
  type OverlayPosition,
  type OverlaySize,
  type TextOverlay,
} from '@/lib/episodeCut';

import { Segmented } from './Segmented';

const POSITIONS: OverlayPosition[] = ['top', 'center', 'bottom'];
const SIZES: Array<{ id: OverlaySize; label: string }> = [
  { id: 'sm', label: 'Small' },
  { id: 'md', label: 'Medium' },
  { id: 'lg', label: 'Large' },
];
const COMMIT_DELAY_MS = 500;

interface CaptionPanelProps {
  overlays: TextOverlay[];
  selectedId: string | null;
  /** Timeline length in seconds; 0 disables adding. */
  total: number;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<TextOverlay>) => void;
  onDelete: (id: string) => void;
}

function CaptionEditor({
  overlay,
  onPatch,
  onDelete,
}: {
  overlay: TextOverlay;
  onPatch: (patch: Partial<TextOverlay>) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(overlay.text);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ text, overlay, onPatch });
  latest.current = { text, overlay, onPatch };

  // Follow external changes (undo, another caption selected).
  useEffect(() => setText(overlay.text), [overlay.id, overlay.text]);

  const flush = () => {
    clearTimeout(timer.current);
    const { text: t, overlay: o, onPatch: patch } = latest.current;
    if (t.trim() && t !== o.text) patch({ text: t });
  };
  // Never lose typing to unmount / selection change.
  useEffect(() => flush, [overlay.id]);

  const numberField = (id: string, label: string, value: number, key: 'start' | 'end') => (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        step={0.1}
        value={Number(value.toFixed(2))}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onPatch({ [key]: n });
        }}
        className="h-8 w-24"
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`caption-text-${overlay.id}`} className="text-xs">
          Text
        </Label>
        <Textarea
          id={`caption-text-${overlay.id}`}
          value={text}
          rows={2}
          maxLength={300}
          onChange={(e) => {
            setText(e.target.value);
            clearTimeout(timer.current);
            timer.current = setTimeout(flush, COMMIT_DELAY_MS);
          }}
          onBlur={flush}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {numberField(`caption-start-${overlay.id}`, 'Start (s)', overlay.start, 'start')}
        {numberField(`caption-end-${overlay.id}`, 'End (s)', overlay.end, 'end')}
        <Segmented
          label="Position"
          value={overlay.position}
          options={POSITIONS.map((p) => ({ id: p, label: p }))}
          onChange={(position) => onPatch({ position })}
        />
        <Segmented
          label="Size"
          value={overlay.size}
          options={SIZES}
          onChange={(size) => onPatch({ size })}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1.5 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  );
}

export function CaptionPanel({
  overlays,
  selectedId,
  total,
  onSelect,
  onAdd,
  onPatch,
  onDelete,
}: CaptionPanelProps) {
  const selected = overlays.find((o) => o.id === selectedId) ?? null;
  const full = overlays.length >= MAX_OVERLAYS;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">
          Captions &amp; titles
          <span className="ml-1.5 font-normal text-muted-foreground">
            burned into the export at the times shown on the caption lane
          </span>
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={total <= 0 || full}
          onClick={onAdd}
          title="Add a caption at the playhead (C)"
        >
          <Plus className="h-3.5 w-3.5" />
          Add caption
        </Button>
      </div>

      {selected ? (
        <CaptionEditor
          overlay={selected}
          onPatch={(patch) => onPatch(selected.id, patch)}
          onDelete={() => onDelete(selected.id)}
        />
      ) : overlays.length > 0 ? (
        <ul className="space-y-1">
          {overlays.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                onClick={() => onSelect(o.id)}
              >
                <span className="truncate">{o.text}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {o.start.toFixed(1)}s – {o.end.toFixed(1)}s
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          No captions yet. Move the playhead where you want one and press <kbd>C</kbd>, or
          double-click the caption lane under the timeline.
        </p>
      )}
    </div>
  );
}

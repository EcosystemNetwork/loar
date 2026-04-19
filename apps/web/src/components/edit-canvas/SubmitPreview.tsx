/**
 * SubmitPreview — side-by-side before/after of a completed job with
 * "Keep as new version" and "Discard" actions.
 *
 * Kept as an inline card (not a modal) so users can scroll back and paint
 * more masks without losing the preview.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Check, X } from 'lucide-react';

export function SubmitPreview({
  beforeUrl,
  afterUrl,
  onKeep,
  onDiscard,
  isKeeping,
}: {
  beforeUrl: string;
  afterUrl: string;
  onKeep: (label: string) => void;
  onDiscard: () => void;
  isKeeping: boolean;
}) {
  const [label, setLabel] = useState('');
  return (
    <Card className="border-primary/40">
      <CardContent className="p-4 space-y-3">
        <div className="text-sm font-medium">Preview — keep this edit as a new version?</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Before
            </div>
            <img src={beforeUrl} alt="before" className="w-full rounded border border-border/40" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              After
            </div>
            <img src={afterUrl} alt="after" className="w-full rounded border border-border/40" />
          </div>
        </div>
        <Input
          placeholder='Label this version (e.g. "removed signpost")'
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          className="h-8 text-sm"
        />
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => onKeep(label.trim())} disabled={isKeeping}>
            <Check className="h-4 w-4 mr-1" />
            Keep as new version
          </Button>
          <Button variant="outline" onClick={onDiscard} disabled={isKeeping}>
            <X className="h-4 w-4 mr-1" />
            Discard
          </Button>
        </div>
        <div className="text-[10px] text-muted-foreground">
          Keeping creates a traceable child of this asset. The original version stays — you can
          revert any time.
        </div>
      </CardContent>
    </Card>
  );
}

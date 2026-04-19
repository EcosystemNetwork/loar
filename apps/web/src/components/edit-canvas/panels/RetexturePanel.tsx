/**
 * RetexturePanel — swap the surface material/fabric/finish while preserving
 * subject geometry. No mask; the model retextures globally per prompt.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Layers3 } from 'lucide-react';
import { toast } from 'sonner';
import type { UseEditSessionResult } from '@/hooks/useEditSession';

const PRESETS = [
  'polished marble',
  'brushed titanium',
  'cast bronze',
  'weathered wood',
  'woven linen',
  'hammered copper',
  'holographic chrome',
  'charcoal ceramic',
];

export function RetexturePanel({
  imageUrl,
  session,
  onJobComplete,
}: {
  imageUrl: string;
  session: UseEditSessionResult;
  onJobComplete: (job: { jobId: string; outputUrl: string; beforeUrl: string }) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  async function handleRun() {
    if (!prompt.trim()) {
      toast.error('Describe the new material');
      return;
    }
    setIsRunning(true);
    try {
      const job = await session.runRetexture({ prompt });
      onJobComplete({ jobId: job.jobId, outputUrl: job.outputUrl, beforeUrl: imageUrl });
    } catch (err: any) {
      toast.error(err?.message || 'Retexture failed');
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <img
            src={imageUrl}
            alt="source"
            className="w-full rounded border border-border/40 max-h-[540px] object-contain bg-black/20"
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <div className="text-xs font-medium mb-2">Material presets</div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Badge
                  key={p}
                  variant="outline"
                  className="cursor-pointer text-[11px] py-1 px-2"
                  onClick={() => setPrompt(p)}
                >
                  {p}
                </Badge>
              ))}
            </div>
          </div>
          <Textarea
            placeholder="Describe the new material / surface / finish"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <Button onClick={handleRun} disabled={isRunning || !session.sessionId} className="w-full">
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Retexturing…
              </>
            ) : (
              <>
                <Layers3 className="h-4 w-4 mr-1.5" />
                Run retexture
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

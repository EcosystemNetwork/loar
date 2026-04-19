/**
 * OutpaintPanel — expand/reframe beyond the original canvas.
 *
 * No mask — model handles seamless blending. User picks aspect, anchor,
 * zoom, and optional prompt guidance for the new regions.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Loader2, Expand } from 'lucide-react';
import { toast } from 'sonner';
import type { UseEditSessionResult } from '@/hooks/useEditSession';

type Aspect = '1:1' | '4:5' | '16:9' | '9:16' | '21:9';
const ASPECTS: Aspect[] = ['1:1', '4:5', '16:9', '9:16', '21:9'];

const ANCHORS: Array<{ id: string; x: number; y: number; label: string }> = [
  { id: 'tl', x: 0, y: 0, label: '↖' },
  { id: 'tc', x: 0.5, y: 0, label: '↑' },
  { id: 'tr', x: 1, y: 0, label: '↗' },
  { id: 'cl', x: 0, y: 0.5, label: '←' },
  { id: 'cc', x: 0.5, y: 0.5, label: '·' },
  { id: 'cr', x: 1, y: 0.5, label: '→' },
  { id: 'bl', x: 0, y: 1, label: '↙' },
  { id: 'bc', x: 0.5, y: 1, label: '↓' },
  { id: 'br', x: 1, y: 1, label: '↘' },
];

export function OutpaintPanel({
  imageUrl,
  session,
  onJobComplete,
}: {
  imageUrl: string;
  session: UseEditSessionResult;
  onJobComplete: (job: { jobId: string; outputUrl: string; beforeUrl: string }) => void;
}) {
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [anchorId, setAnchorId] = useState('cc');
  const [zoom, setZoom] = useState(1.5);
  const [mode, setMode] = useState<'preserve' | 'creative'>('preserve');
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  async function handleRun() {
    const anchor = ANCHORS.find((a) => a.id === anchorId)!;
    setIsRunning(true);
    try {
      const job = await session.runOutpaint({
        targetAspect: aspect,
        anchorX: anchor.x,
        anchorY: anchor.y,
        zoomFactor: zoom,
        mode,
        prompt,
      });
      onJobComplete({ jobId: job.jobId, outputUrl: job.outputUrl, beforeUrl: imageUrl });
    } catch (err: any) {
      toast.error(err?.message || 'Outpaint failed');
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
        <CardContent className="p-4 space-y-4">
          <div>
            <div className="text-xs font-medium mb-2">Target aspect</div>
            <div className="flex flex-wrap gap-2">
              {ASPECTS.map((a) => (
                <Button
                  key={a}
                  variant={aspect === a ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAspect(a)}
                >
                  {a}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium mb-2">
              Anchor — where the original sits in the new canvas
            </div>
            <div className="grid grid-cols-3 gap-1 w-24">
              {ANCHORS.map((a) => (
                <Button
                  key={a.id}
                  variant={anchorId === a.id ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 w-8 p-0 text-lg"
                  onClick={() => setAnchorId(a.id)}
                  title={`anchorX=${a.x} anchorY=${a.y}`}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium mb-2">
              <span>Zoom-out factor</span>
              <span className="text-muted-foreground">{zoom.toFixed(2)}×</span>
            </div>
            <Slider
              value={[zoom]}
              onValueChange={([v]) => setZoom(v)}
              min={1}
              max={4}
              step={0.05}
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant={mode === 'preserve' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('preserve')}
            >
              Preserve original
            </Button>
            <Button
              variant={mode === 'creative' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('creative')}
            >
              Creative extension
            </Button>
          </div>

          <Textarea
            placeholder="Optional: describe what the new regions should look like"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="text-sm"
          />

          <Button onClick={handleRun} disabled={isRunning || !session.sessionId} className="w-full">
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Expanding…
              </>
            ) : (
              <>
                <Expand className="h-4 w-4 mr-1.5" />
                Expand to {aspect}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

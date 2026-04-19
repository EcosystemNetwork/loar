/**
 * InpaintPanel — brush-mask inpaint / remove / replace / fix.
 *
 * Reuses the existing `InpaintCanvas` component (brush + polygon lasso +
 * mask export). The working surface is whatever url the shell passes in —
 * for video assets, that's a captured frame; for image assets, the source.
 */

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { InpaintCanvas, type InpaintCanvasHandle } from '@/components/editing/InpaintCanvas';
import type { UseEditSessionResult } from '@/hooks/useEditSession';

type Mode = 'replace' | 'remove' | 'add' | 'fix';

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'replace', label: 'Replace', hint: 'Swap the masked region' },
  { id: 'remove', label: 'Remove', hint: 'Erase seamlessly' },
  { id: 'add', label: 'Add', hint: 'Paint in something new' },
  { id: 'fix', label: 'Fix', hint: 'Repair anatomy/artifacts' },
];

export function InpaintPanel({
  imageUrl,
  session,
  onJobComplete,
}: {
  imageUrl: string;
  session: UseEditSessionResult;
  onJobComplete: (job: { jobId: string; outputUrl: string; beforeUrl: string }) => void;
}) {
  const canvasRef = useRef<InpaintCanvasHandle>(null);
  const [mode, setMode] = useState<Mode>('replace');
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  async function handleRun() {
    if (!canvasRef.current?.hasMask()) {
      toast.error('Paint a mask first');
      return;
    }
    if (mode === 'replace' && !prompt.trim()) {
      toast.error('Replace needs a prompt');
      return;
    }
    const blob = await canvasRef.current.exportMaskBlob();
    if (!blob) {
      toast.error('Could not export mask');
      return;
    }
    setIsRunning(true);
    try {
      const pngBase64 = await blobToBase64(blob);
      const { maskId } = await session.uploadMask(pngBase64);
      const job = await session.runInpaint({ maskId, prompt, mode });
      onJobComplete({ jobId: job.jobId, outputUrl: job.outputUrl, beforeUrl: imageUrl });
    } catch (err: any) {
      toast.error(err?.message || 'Inpaint failed');
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <InpaintCanvas
            ref={canvasRef}
            imageUrl={imageUrl}
            onMaskChange={() => {}}
            width={960}
            height={540}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <Button
                key={m.id}
                variant={mode === m.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground ml-auto self-center">
              {MODES.find((o) => o.id === mode)?.hint}
            </span>
          </div>
          <Textarea
            placeholder={
              mode === 'remove'
                ? 'Optional: describe what the empty area should look like'
                : 'Describe what should go in the masked region…'
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <Button onClick={handleRun} disabled={isRunning || !session.sessionId} className="w-full">
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Running inpaint…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1.5" />
                Run inpaint
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

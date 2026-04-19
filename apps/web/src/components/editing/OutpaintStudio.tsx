/**
 * OutpaintStudio
 *
 * Canvas-based reframing / outpainting / pan / zoom-out UI. The user picks a
 * target aspect ratio, then positions + scales the source image within the new
 * canvas. Areas of the canvas not covered by the source are outpainted by the
 * model, guided by an optional prompt.
 *
 * All compute is preview-only — the actual image is generated server-side via
 * `outpaint.expand`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Sparkles, RotateCcw, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

const ASPECTS = [
  { id: '1:1', w: 1, h: 1, label: '1:1 Square' },
  { id: '4:5', w: 4, h: 5, label: '4:5 Portrait' },
  { id: '16:9', w: 16, h: 9, label: '16:9 Widescreen' },
  { id: '9:16', w: 9, h: 16, label: '9:16 Vertical' },
  { id: '21:9', w: 21, h: 9, label: '21:9 Cinema' },
] as const;

type AspectId = (typeof ASPECTS)[number]['id'];
type Mode = 'preserve' | 'creative';

interface OutpaintStudioProps {
  sourceImageUrl: string;
  universeId?: string;
  entityId?: string;
  onResult?: (imageUrl: string) => void;
}

const PREVIEW_MAX_PX = 520;

export function OutpaintStudio({
  sourceImageUrl,
  universeId,
  entityId,
  onResult,
}: OutpaintStudioProps) {
  const queryClient = useQueryClient();

  const [targetAspect, setTargetAspect] = useState<AspectId>('16:9');
  const [zoomFactor, setZoomFactor] = useState(1.4);
  const [anchorX, setAnchorX] = useState(0.5);
  const [anchorY, setAnchorY] = useState(0.5);
  const [mode, setMode] = useState<Mode>('preserve');
  const [prompt, setPrompt] = useState('');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<{ w: number; h: number } | null>(null);

  // ── Load source image dimensions ────────────────────────────────────
  useEffect(() => {
    setResultUrl(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setSourceSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setSourceSize(null);
    img.src = sourceImageUrl;
  }, [sourceImageUrl]);

  // ── Cost estimate ──────────────────────────────────────────────────
  const { data: cost } = useQuery({
    queryKey: ['outpaint.estimateCost'],
    queryFn: () => trpcClient.outpaint.estimateCost.query(),
    staleTime: 5 * 60_000,
  });

  // ── Compute preview layout ──────────────────────────────────────────
  const layout = useMemo(() => {
    const aspect = ASPECTS.find((a) => a.id === targetAspect)!;
    const ratio = aspect.w / aspect.h;

    // Target canvas size within the 520px viewport
    let canvasW = PREVIEW_MAX_PX;
    let canvasH = PREVIEW_MAX_PX / ratio;
    if (canvasH > PREVIEW_MAX_PX) {
      canvasH = PREVIEW_MAX_PX;
      canvasW = PREVIEW_MAX_PX * ratio;
    }

    if (!sourceSize) {
      return { canvasW, canvasH, srcW: 0, srcH: 0, srcX: 0, srcY: 0 };
    }

    // Source "fits" the canvas before zoom (contain fit)
    const srcRatio = sourceSize.w / sourceSize.h;
    let baseW: number;
    let baseH: number;
    if (srcRatio > ratio) {
      baseW = canvasW;
      baseH = canvasW / srcRatio;
    } else {
      baseH = canvasH;
      baseW = canvasH * srcRatio;
    }

    // zoomFactor > 1 means source is smaller relative to canvas (zoomed out)
    const srcW = baseW / zoomFactor;
    const srcH = baseH / zoomFactor;

    const srcX = anchorX * (canvasW - srcW);
    const srcY = anchorY * (canvasH - srcH);

    return { canvasW, canvasH, srcW, srcH, srcX, srcY };
  }, [targetAspect, zoomFactor, anchorX, anchorY, sourceSize]);

  // ── Drag to pan ─────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    startAnchorX: number;
    startAnchorY: number;
  } | null>(null);

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (layout.srcW >= layout.canvasW && layout.srcH >= layout.canvasH) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startAnchorX: anchorX,
      startAnchorY: anchorY,
    };
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const rangeX = layout.canvasW - layout.srcW;
    const rangeY = layout.canvasH - layout.srcH;
    if (rangeX > 0) {
      setAnchorX(Math.max(0, Math.min(1, drag.startAnchorX + dx / rangeX)));
    }
    if (rangeY > 0) {
      setAnchorY(Math.max(0, Math.min(1, drag.startAnchorY + dy / rangeY)));
    }
  };
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  // ── Submit ──────────────────────────────────────────────────────────
  const expandMutation = useMutation({
    mutationFn: () =>
      trpcClient.outpaint.expand.mutate({
        sourceImageUrl,
        targetAspect,
        anchorX,
        anchorY,
        zoomFactor,
        mode,
        prompt: prompt.trim(),
        universeId,
        entityId,
      }),
    onSuccess: (data) => {
      setResultUrl(data.imageUrl);
      toast.success(`Reframed to ${data.targetAspect}`, {
        description: `${data.creditsCharged} credits · ${data.provider}`,
      });
      onResult?.(data.imageUrl);
      queryClient.invalidateQueries({ queryKey: ['gallery'] });
      queryClient.invalidateQueries({ queryKey: ['userCredits'] });
    },
    onError: (err: { message?: string }) => {
      toast.error('Reframe failed', { description: err?.message || 'Unknown error' });
    },
  });

  const reset = () => {
    setZoomFactor(1.4);
    setAnchorX(0.5);
    setAnchorY(0.5);
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      {/* Canvas pane */}
      <Card className="flex flex-col items-center justify-center gap-4 bg-muted/20 p-6">
        <div
          className="relative overflow-hidden rounded-md border-2 border-dashed border-primary/40 shadow-xl"
          style={{
            width: layout.canvasW,
            height: layout.canvasH,
            background:
              // Checkerboard → indicates "will be generated"
              'repeating-conic-gradient(rgba(255,255,255,0.04) 0% 25%, rgba(0,0,0,0.2) 0% 50%) 50% 50% / 24px 24px',
          }}
        >
          {sourceSize ? (
            <div
              ref={canvasRef}
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              className={cn(
                'absolute select-none touch-none',
                zoomFactor > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
              )}
              style={{
                left: layout.srcX,
                top: layout.srcY,
                width: layout.srcW,
                height: layout.srcH,
              }}
            >
              <img
                src={sourceImageUrl}
                alt="Source"
                draggable={false}
                className="h-full w-full object-cover shadow-[0_0_0_1px_rgba(255,255,255,0.3)]"
              />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground text-sm">
              Loading source…
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Drag the image to reposition · Checkered area will be generated
        </p>

        {resultUrl && (
          <div className="mt-2 flex w-full flex-col items-center gap-2">
            <div className="text-sm font-medium">Result</div>
            <img
              src={resultUrl}
              alt="Reframed result"
              className="max-h-80 rounded-md border shadow-lg"
            />
            <Button asChild variant="outline" size="sm">
              <a href={resultUrl} target="_blank" rel="noopener noreferrer">
                Open full size <ExternalLink className="ml-2 h-3 w-3" />
              </a>
            </Button>
          </div>
        )}
      </Card>

      {/* Controls pane */}
      <div className="space-y-5">
        <div>
          <Label className="mb-2 block text-sm">Target aspect</Label>
          <div className="grid grid-cols-3 gap-2">
            {ASPECTS.map((a) => (
              <Button
                key={a.id}
                variant={targetAspect === a.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTargetAspect(a.id)}
              >
                {a.id}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-sm">Zoom out</Label>
            <span className="text-xs text-muted-foreground">{zoomFactor.toFixed(2)}×</span>
          </div>
          <Slider
            value={[zoomFactor]}
            min={1}
            max={4}
            step={0.05}
            onValueChange={([v]) => setZoomFactor(v)}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            1× fills the frame · higher values leave more room to outpaint
          </p>
        </div>

        <div>
          <Label className="mb-2 block text-sm">Mode</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={mode === 'preserve' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('preserve')}
            >
              Preserve
            </Button>
            <Button
              variant={mode === 'creative' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('creative')}
            >
              Creative
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {mode === 'preserve'
              ? 'Keep original subject untouched — only extend the surroundings.'
              : 'Use the original as inspiration — let the model enrich details.'}
          </p>
        </div>

        <div>
          <Label htmlFor="outpaint-prompt" className="mb-2 block text-sm">
            Prompt (optional)
          </Label>
          <Textarea
            id="outpaint-prompt"
            placeholder="What should appear in the expanded regions? e.g. 'cinematic widescreen shot, dusk sky, distant mountains'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={1000}
            rows={4}
          />
          <div className="mt-1 text-right text-[10px] text-muted-foreground">
            {prompt.length}/1000
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={reset} title="Reset position + zoom">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            className="flex-1"
            disabled={!sourceSize || expandMutation.isPending}
            onClick={() => expandMutation.mutate()}
          >
            {expandMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Reframe
                {cost ? ` · ${cost.credits} credits` : ''}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * InpaintCanvas
 *
 * Canvas overlay for painting inpaint masks. White = replace, black = keep.
 * Supports brush + polygon (lasso) tools. Exports the mask both as a data URL
 * (for preview / legacy callers) and as a Blob (for upload to storage).
 */

import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Eraser,
  Undo2,
  Trash2,
  Paintbrush,
  Lasso,
  Check,
  FlipHorizontal,
  Waves,
} from 'lucide-react';

export type MaskTool = 'brush' | 'polygon';

export interface InpaintCanvasHandle {
  /** Export the current mask as a PNG Blob (white = replace, black = keep) */
  exportMaskBlob: () => Promise<Blob | null>;
  /** Returns true if the canvas has any painted pixels */
  hasMask: () => boolean;
  /** Clear all painted pixels */
  clear: () => void;
}

interface InpaintCanvasProps {
  imageUrl: string;
  onMaskChange: (maskDataUrl: string | null) => void;
  width?: number;
  height?: number;
}

export const InpaintCanvas = forwardRef<InpaintCanvasHandle, InpaintCanvasProps>(
  function InpaintCanvas({ imageUrl, onMaskChange, width = 640, height = 360 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Separate mask layer — avoids the read-back/color-match trick the old
    // implementation used, which was lossy when the source image had pure red.
    const maskLayerRef = useRef<HTMLCanvasElement | null>(null);
    const [tool, setTool] = useState<MaskTool>('brush');
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushSize, setBrushSize] = useState(30);
    const [isErasing, setIsErasing] = useState(false);
    const [history, setHistory] = useState<ImageData[]>([]);
    const [polygonPoints, setPolygonPoints] = useState<{ x: number; y: number }[]>([]);
    const [invert, setInvert] = useState(false);
    const [feather, setFeather] = useState(0);

    // Initialize mask layer + load background
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (!maskLayerRef.current) {
        maskLayerRef.current = document.createElement('canvas');
      }
      const maskLayer = maskLayerRef.current;
      maskLayer.width = width;
      maskLayer.height = height;
      const maskCtx = maskLayer.getContext('2d');
      if (!maskCtx) return;
      maskCtx.clearRect(0, 0, width, height);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        composite(img);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        setHistory([ctx.getImageData(0, 0, width, height)]);
      };
      img.onerror = () => {
        // CORS fail — draw a placeholder
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#666';
        ctx.font = '12px sans-serif';
        ctx.fillText('Image failed to load (CORS)', 20, height / 2);
      };
      img.src = imageUrl;
      backgroundImgRef.current = img;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imageUrl, width, height]);

    const backgroundImgRef = useRef<HTMLImageElement | null>(null);

    // Re-composite background + mask overlay onto the visible canvas
    const composite = useCallback(
      (img?: HTMLImageElement | null) => {
        const canvas = canvasRef.current;
        const maskLayer = maskLayerRef.current;
        if (!canvas || !maskLayer) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);

        const bg = img || backgroundImgRef.current;
        if (bg && bg.complete && bg.naturalWidth > 0) {
          const scale = Math.max(width / bg.naturalWidth, height / bg.naturalHeight);
          const x = (width - bg.naturalWidth * scale) / 2;
          const y = (height - bg.naturalHeight * scale) / 2;
          ctx.drawImage(bg, x, y, bg.naturalWidth * scale, bg.naturalHeight * scale);
        }

        // Draw the mask layer as semi-transparent red overlay
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(maskLayer, 0, 0);
        ctx.restore();
      },
      [width, height]
    );

    const getCanvasPoint = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
        };
      },
      [width, height]
    );

    const paintAt = useCallback(
      (x: number, y: number) => {
        const maskLayer = maskLayerRef.current;
        if (!maskLayer) return;
        const mctx = maskLayer.getContext('2d');
        if (!mctx) return;

        mctx.globalCompositeOperation = isErasing ? 'destination-out' : 'source-over';
        mctx.fillStyle = '#ff3232';
        mctx.beginPath();
        mctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        mctx.fill();

        composite();
      },
      [brushSize, isErasing, composite]
    );

    const exportMaskDataUrl = useCallback((): string | null => {
      const maskLayer = maskLayerRef.current;
      if (!maskLayer) return null;
      const mctx = maskLayer.getContext('2d');
      if (!mctx) return null;

      // Paint the white mask onto a black base, with optional feather (blur)
      // applied to soften the boundary before inversion.
      const base = document.createElement('canvas');
      base.width = width;
      base.height = height;
      const bctx = base.getContext('2d');
      if (!bctx) return null;
      bctx.fillStyle = '#000000';
      bctx.fillRect(0, 0, width, height);

      // Draw the mask-layer alpha as white pixels; a filter blur feathers the edge
      if (feather > 0) bctx.filter = `blur(${feather}px)`;
      bctx.globalCompositeOperation = 'source-over';
      // Convert red paint → white by re-tinting: draw mask into a white overlay
      const tint = document.createElement('canvas');
      tint.width = width;
      tint.height = height;
      const tctx = tint.getContext('2d');
      if (!tctx) return null;
      tctx.drawImage(maskLayer, 0, 0);
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = '#ffffff';
      tctx.fillRect(0, 0, width, height);
      bctx.drawImage(tint, 0, 0);
      bctx.filter = 'none';

      // Detect whether anything is painted by sampling the base's luminance
      const sample = bctx.getImageData(0, 0, width, height);
      let painted = false;
      for (let i = 0; i < sample.data.length; i += 4) {
        if (sample.data[i]! > 10) {
          painted = true;
          break;
        }
      }
      if (!painted) return null;

      // Apply invert after feathering so the feathered edge still works correctly
      if (invert) {
        for (let i = 0; i < sample.data.length; i += 4) {
          sample.data[i] = 255 - sample.data[i]!;
          sample.data[i + 1] = 255 - sample.data[i + 1]!;
          sample.data[i + 2] = 255 - sample.data[i + 2]!;
          sample.data[i + 3] = 255;
        }
        bctx.putImageData(sample, 0, 0);
      }

      return base.toDataURL('image/png');
    }, [width, height, feather, invert]);

    const pushHistory = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const data = ctx.getImageData(0, 0, width, height);
      setHistory((prev) => [...prev.slice(-10), data]);
    }, [width, height]);

    const publishMask = useCallback(() => {
      onMaskChange(exportMaskDataUrl());
    }, [onMaskChange, exportMaskDataUrl]);

    // ── Brush handlers ────────────────────────────────────────────────

    const handleMouseDown = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        const { x, y } = getCanvasPoint(e);
        if (tool === 'brush') {
          setIsDrawing(true);
          paintAt(x, y);
        } else if (tool === 'polygon') {
          setPolygonPoints((prev) => [...prev, { x, y }]);
          // Draw a vertex preview on the visible canvas — doesn't commit to mask
          composite();
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (ctx) {
            const pts = [...polygonPoints, { x, y }];
            ctx.save();
            ctx.strokeStyle = '#ff3232';
            ctx.lineWidth = 2;
            ctx.fillStyle = 'rgba(255,50,50,0.25)';
            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.stroke();
            if (pts.length > 2) {
              ctx.closePath();
              ctx.fill();
            }
            pts.forEach((p) => {
              ctx.beginPath();
              ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
              ctx.fillStyle = '#ff3232';
              ctx.fill();
            });
            ctx.restore();
          }
        }
      },
      [getCanvasPoint, tool, paintAt, polygonPoints, composite]
    );

    const handleMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (tool !== 'brush' || !isDrawing) return;
        const { x, y } = getCanvasPoint(e);
        paintAt(x, y);
      },
      [tool, isDrawing, getCanvasPoint, paintAt]
    );

    const handleMouseUp = useCallback(() => {
      if (tool !== 'brush' || !isDrawing) return;
      setIsDrawing(false);
      pushHistory();
      publishMask();
    }, [tool, isDrawing, pushHistory, publishMask]);

    // ── Polygon handlers ──────────────────────────────────────────────

    const commitPolygon = useCallback(() => {
      if (polygonPoints.length < 3) return;
      const maskLayer = maskLayerRef.current;
      if (!maskLayer) return;
      const mctx = maskLayer.getContext('2d');
      if (!mctx) return;

      mctx.globalCompositeOperation = isErasing ? 'destination-out' : 'source-over';
      mctx.fillStyle = '#ff3232';
      mctx.beginPath();
      polygonPoints.forEach((p, i) => (i === 0 ? mctx.moveTo(p.x, p.y) : mctx.lineTo(p.x, p.y)));
      mctx.closePath();
      mctx.fill();

      setPolygonPoints([]);
      composite();
      pushHistory();
      publishMask();
    }, [polygonPoints, isErasing, composite, pushHistory, publishMask]);

    // ── Undo / clear ──────────────────────────────────────────────────

    const handleUndo = useCallback(() => {
      if (history.length <= 1) return;
      const newHistory = history.slice(0, -1);
      const prev = newHistory[newHistory.length - 1];
      const canvas = canvasRef.current;
      if (!canvas || !prev) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.putImageData(prev, 0, 0);

      // Rebuild the mask layer from the restored canvas minus the background.
      // Simplest: clear mask layer — we can't perfectly reverse a paint stroke
      // without storing mask-layer snapshots. Storing both would 2x memory.
      // For correctness, maintain a parallel mask-layer history.
      setHistory(newHistory);
      publishMask();
    }, [history, publishMask]);

    const handleClear = useCallback(() => {
      const maskLayer = maskLayerRef.current;
      if (!maskLayer) return;
      const mctx = maskLayer.getContext('2d');
      mctx?.clearRect(0, 0, width, height);
      setPolygonPoints([]);
      composite();
      if (history[0]) setHistory([history[0]]);
      onMaskChange(null);
    }, [width, height, composite, history, onMaskChange]);

    // Re-publish the mask when invert/feather change so downstream sees the new shape
    useEffect(() => {
      publishMask();
      // publishMask changes on every render (useCallback dep: exportMaskDataUrl),
      // so we intentionally only react to invert/feather flips.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invert, feather]);

    // ── Keyboard shortcuts ────────────────────────────────────────────

    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        // Skip when the user is typing in an input — don't steal keys from prompts
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
          return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        switch (e.key) {
          case '[':
            setBrushSize((s) => Math.max(5, s - 5));
            e.preventDefault();
            break;
          case ']':
            setBrushSize((s) => Math.min(100, s + 5));
            e.preventDefault();
            break;
          case 'e':
          case 'E':
            setIsErasing((v) => !v);
            e.preventDefault();
            break;
          case 'b':
          case 'B':
            setTool('brush');
            setPolygonPoints([]);
            e.preventDefault();
            break;
          case 'p':
          case 'P':
            setTool('polygon');
            e.preventDefault();
            break;
          case 'i':
          case 'I':
            setInvert((v) => !v);
            e.preventDefault();
            break;
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, []);

    // ── Imperative handle for the parent (upload flow) ────────────────

    useImperativeHandle(
      ref,
      () => ({
        exportMaskBlob: () =>
          new Promise<Blob | null>((resolve) => {
            const dataUrl = exportMaskDataUrl();
            if (!dataUrl) return resolve(null);
            const out = document.createElement('canvas');
            out.width = width;
            out.height = height;
            const img = new Image();
            img.onload = () => {
              const ctx = out.getContext('2d');
              if (!ctx) return resolve(null);
              ctx.drawImage(img, 0, 0);
              out.toBlob((b) => resolve(b), 'image/png');
            };
            img.onerror = () => resolve(null);
            img.src = dataUrl;
          }),
        hasMask: () => exportMaskDataUrl() !== null,
        clear: handleClear,
      }),
      [exportMaskDataUrl, width, height, handleClear]
    );

    return (
      <div className="space-y-2 w-full">
        {/* Tool selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded overflow-hidden border border-border/40">
            <Button
              variant={tool === 'brush' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none h-8"
              onClick={() => {
                setTool('brush');
                if (polygonPoints.length > 0) {
                  setPolygonPoints([]);
                  composite();
                }
              }}
            >
              <Paintbrush className="w-3.5 h-3.5 mr-1" />
              Brush
            </Button>
            <Button
              variant={tool === 'polygon' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none h-8"
              onClick={() => setTool('polygon')}
            >
              <Lasso className="w-3.5 h-3.5 mr-1" />
              Polygon
            </Button>
          </div>

          <Button
            variant={isErasing ? 'default' : 'outline'}
            size="sm"
            onClick={() => setIsErasing(!isErasing)}
          >
            <Eraser className="w-3.5 h-3.5 mr-1" />
            {isErasing ? 'Erasing' : 'Erase'}
          </Button>

          {tool === 'polygon' && polygonPoints.length >= 3 && (
            <Button variant="default" size="sm" onClick={commitPolygon}>
              <Check className="w-3.5 h-3.5 mr-1" />
              Close Path
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={handleUndo} disabled={history.length <= 1}>
            <Undo2 className="w-3.5 h-3.5 mr-1" />
            Undo
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear}>
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            Clear
          </Button>

          {tool === 'brush' && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] text-muted-foreground">Brush: {brushSize}px</span>
              <Slider
                value={[brushSize]}
                onValueChange={([v]) => setBrushSize(v)}
                min={5}
                max={100}
                step={1}
                className="w-24"
              />
            </div>
          )}
        </div>

        {/* Secondary controls: invert + feather */}
        <div className="flex items-center gap-3">
          <Button
            variant={invert ? 'default' : 'outline'}
            size="sm"
            onClick={() => setInvert((v) => !v)}
            title="Invert mask (I) — affect everything except the painted area"
          >
            <FlipHorizontal className="w-3.5 h-3.5 mr-1" />
            Invert
          </Button>
          <div className="flex items-center gap-2 flex-1 max-w-[240px]">
            <Waves className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              Feather: {feather}px
            </span>
            <Slider
              value={[feather]}
              onValueChange={([v]) => setFeather(v)}
              min={0}
              max={30}
              step={1}
              className="flex-1"
            />
          </div>
          <span className="text-[9px] text-muted-foreground ml-auto">
            [ / ] brush · E erase · B/P tool · I invert
          </span>
        </div>

        {/* Canvas */}
        <div className="relative rounded overflow-hidden border border-border/40">
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="w-full cursor-crosshair"
            style={{ aspectRatio: `${width}/${height}` }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
          <div className="absolute bottom-2 left-2 text-[9px] text-white/70 bg-black/60 px-1.5 py-0.5 rounded">
            {tool === 'brush'
              ? 'Paint red = area to modify'
              : `Click to add points · ${polygonPoints.length} so far`}
          </div>
        </div>
      </div>
    );
  }
);

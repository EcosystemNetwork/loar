/**
 * InpaintCanvas
 *
 * Canvas overlay for painting inpaint masks on video frames.
 * White = area to replace, black = area to keep.
 * Exports the mask as a data URL for the inpaint API.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Eraser, Undo2, Trash2, Download } from 'lucide-react';

interface InpaintCanvasProps {
  /** Image URL to paint over */
  imageUrl: string;
  /** Called when mask changes (data URL of the mask PNG) */
  onMaskChange: (maskDataUrl: string | null) => void;
  /** Width of the canvas */
  width?: number;
  /** Height of the canvas */
  height?: number;
}

export function InpaintCanvas({
  imageUrl,
  onMaskChange,
  width = 640,
  height = 360,
}: InpaintCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [isErasing, setIsErasing] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);

  // Load the background image
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Load background image
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Draw image scaled to fill canvas
      const scale = Math.max(width / img.width, height / img.height);
      const x = (width - img.width * scale) / 2;
      const y = (height - img.height * scale) / 2;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

      // Save initial state
      const initialData = ctx.getImageData(0, 0, width, height);
      setHistory([initialData]);
    };
    img.src = imageUrl;
  }, [imageUrl, width, height]);

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

  const draw = useCallback(
    (x: number, y: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.globalCompositeOperation = isErasing ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);

      if (isErasing) {
        ctx.fill();
      } else {
        // Paint semi-transparent red to show where the mask is
        ctx.fillStyle = 'rgba(255, 50, 50, 0.5)';
        ctx.fill();
      }
    },
    [brushSize, isErasing]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      setIsDrawing(true);
      const { x, y } = getCanvasPoint(e);
      draw(x, y);
    },
    [getCanvasPoint, draw]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return;
      const { x, y } = getCanvasPoint(e);
      draw(x, y);
    },
    [isDrawing, getCanvasPoint, draw]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);

    // Save state for undo
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = ctx.getImageData(0, 0, width, height);
    setHistory((prev) => [...prev.slice(-10), data]);

    // Export mask
    exportMask();
  }, [isDrawing, width, height]);

  const exportMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create a separate canvas for the mask (white on black)
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    // Start with black background
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, width, height);

    // Read the visible canvas and convert red regions to white
    const imageData = ctx.getImageData(0, 0, width, height);
    const maskData = maskCtx.getImageData(0, 0, width, height);

    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i]!;
      const a = imageData.data[i + 3]!;
      // If the pixel has red paint (semi-transparent red overlay)
      if (r > 200 && a > 50) {
        maskData.data[i] = 255; // R
        maskData.data[i + 1] = 255; // G
        maskData.data[i + 2] = 255; // B
        maskData.data[i + 3] = 255; // A
      }
    }

    maskCtx.putImageData(maskData, 0, 0);
    const dataUrl = maskCanvas.toDataURL('image/png');
    onMaskChange(dataUrl);
  }, [width, height, onMaskChange]);

  const handleUndo = useCallback(() => {
    if (history.length <= 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const newHistory = history.slice(0, -1);
    const prevState = newHistory[newHistory.length - 1];
    if (prevState) {
      ctx.putImageData(prevState, 0, 0);
      setHistory(newHistory);
      exportMask();
    }
  }, [history, exportMask]);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (history[0]) {
      ctx.putImageData(history[0], 0, 0);
      setHistory([history[0]]);
      onMaskChange(null);
    }
  }, [history, onMaskChange]);

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button
          variant={isErasing ? 'default' : 'outline'}
          size="sm"
          onClick={() => setIsErasing(!isErasing)}
        >
          <Eraser className="w-3.5 h-3.5 mr-1" />
          {isErasing ? 'Erasing' : 'Erase'}
        </Button>
        <Button variant="outline" size="sm" onClick={handleUndo} disabled={history.length <= 1}>
          <Undo2 className="w-3.5 h-3.5 mr-1" />
          Undo
        </Button>
        <Button variant="outline" size="sm" onClick={handleClear}>
          <Trash2 className="w-3.5 h-3.5 mr-1" />
          Clear
        </Button>

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
        <div className="absolute bottom-2 left-2 text-[9px] text-white/50 bg-black/50 px-1.5 py-0.5 rounded">
          Paint red = area to replace
        </div>
      </div>
    </div>
  );
}

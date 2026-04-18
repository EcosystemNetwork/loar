/**
 * Motion Brush — Region Mask Editor
 *
 * Canvas overlay for painting motion regions on an input image.
 * White = motion, black = static. Exports as PNG for storage.
 *
 * Feature 4 of the Node Editor Expansion PRD.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Paintbrush, Eraser, RotateCcw, Check, X } from 'lucide-react';

interface MotionBrushProps {
  imageUrl: string;
  initialMaskUrl?: string | null;
  onSave: (maskDataUrl: string) => void;
  onCancel: () => void;
  width?: number;
  height?: number;
}

type Tool = 'paint' | 'erase';

export function MotionBrush({
  imageUrl,
  initialMaskUrl,
  onSave,
  onCancel,
  width = 640,
  height = 360,
}: MotionBrushProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('paint');
  const [brushSize, setBrushSize] = useState(30);
  const [isDrawing, setIsDrawing] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const bgImageRef = useRef<HTMLImageElement | null>(null);

  // Load background image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      bgImageRef.current = img;
      setImageLoaded(true);
      initCanvas(img);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Initialize canvas with background image and optional existing mask
  const initCanvas = useCallback(
    (bgImage: HTMLImageElement) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Draw background image at reduced opacity
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = 0.4;
      ctx.drawImage(bgImage, 0, 0, width, height);
      ctx.globalAlpha = 1.0;

      // Load existing mask if provided
      if (initialMaskUrl) {
        const maskImg = new Image();
        maskImg.crossOrigin = 'anonymous';
        maskImg.onload = () => {
          ctx.globalAlpha = 0.5;
          ctx.drawImage(maskImg, 0, 0, width, height);
          ctx.globalAlpha = 1.0;
        };
        maskImg.src = initialMaskUrl;
      }
    },
    [width, height, initialMaskUrl]
  );

  // Get canvas coordinates from mouse event
  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  // Draw a circle at the given position
  const drawAt = useCallback(
    (x: number, y: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);

      if (tool === 'paint') {
        ctx.fillStyle = 'rgba(0, 255, 0, 0.5)'; // Green for motion regions
        ctx.fill();
      } else {
        // Erase: redraw the background image in this area
        ctx.save();
        ctx.clip();
        ctx.clearRect(x - brushSize, y - brushSize, brushSize * 2, brushSize * 2);
        if (bgImageRef.current) {
          ctx.globalAlpha = 0.4;
          ctx.drawImage(bgImageRef.current, 0, 0, width, height);
          ctx.globalAlpha = 1.0;
        }
        ctx.restore();
      }
    },
    [tool, brushSize, width, height]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      setIsDrawing(true);
      const { x, y } = getCanvasCoords(e);
      drawAt(x, y);
    },
    [getCanvasCoords, drawAt]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return;
      const { x, y } = getCanvasCoords(e);
      drawAt(x, y);
    },
    [isDrawing, getCanvasCoords, drawAt]
  );

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  // Clear the mask
  const handleClear = useCallback(() => {
    if (bgImageRef.current) {
      initCanvas(bgImageRef.current);
    }
  }, [initCanvas]);

  // Export mask as PNG data URL
  const handleSave = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create a separate canvas for the mask only (white on black)
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    // Get the pixel data from the drawing canvas
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Create mask: any green-tinted pixels become white (motion), rest become black (static)
    const maskData = maskCtx.createImageData(width, height);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Detect painted green regions (motion)
      const isMotion = g > r + 20 && g > b + 20;
      const val = isMotion ? 255 : 0;

      maskData.data[i] = val;
      maskData.data[i + 1] = val;
      maskData.data[i + 2] = val;
      maskData.data[i + 3] = 255;
    }

    maskCtx.putImageData(maskData, 0, 0);
    const dataUrl = maskCanvas.toDataURL('image/png');
    onSave(dataUrl);
  }, [width, height, onSave]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Motion Brush</Label>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
            <X className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSave}>
            <Check className="h-3.5 w-3.5 mr-1" />
            Apply Mask
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 bg-muted rounded-lg px-3 py-2">
        <div className="flex gap-1">
          <Button
            variant={tool === 'paint' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setTool('paint')}
          >
            <Paintbrush className="h-3.5 w-3.5 mr-1" />
            Paint Motion
          </Button>
          <Button
            variant={tool === 'erase' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setTool('erase')}
          >
            <Eraser className="h-3.5 w-3.5 mr-1" />
            Erase
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-1">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Size</Label>
          <input
            type="range"
            min={5}
            max={100}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-8">{brushSize}px</span>
        </div>

        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleClear}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      </div>

      {/* Canvas */}
      <div
        className="relative border rounded-lg overflow-hidden bg-black"
        style={{ aspectRatio: `${width}/${height}` }}
      >
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full h-full cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        <p className="absolute bottom-2 left-2 text-[10px] text-white/60 bg-black/50 px-1.5 py-0.5 rounded">
          Green = motion regions, Dark = static
        </p>
      </div>
    </div>
  );
}

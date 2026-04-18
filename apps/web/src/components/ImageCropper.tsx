/**
 * ImageCropper — drag-to-reposition cover image within a fixed aspect ratio frame.
 *
 * Usage:
 *   <ImageCropper
 *     src={objectUrl}
 *     aspectRatio={16/9}
 *     onCrop={(blob) => uploadBlob(blob)}
 *     onCancel={() => setShowCropper(false)}
 *   />
 *
 * The user drags the image to position it, scrolls/pinches to zoom,
 * then clicks "Confirm" to crop via canvas and get the final blob.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Check, X, ZoomIn, ZoomOut, Move } from 'lucide-react';

interface ImageCropperProps {
  src: string;
  aspectRatio?: number;
  outputWidth?: number;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
}

export function ImageCropper({
  src,
  aspectRatio = 16 / 9,
  outputWidth = 1280,
  onCrop,
  onCancel,
}: ImageCropperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [imgLoaded, setImgLoaded] = useState(false);
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);

  // Transform state
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  // Drag state
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Load the image to get natural dimensions
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setNaturalW(img.naturalWidth);
      setNaturalH(img.naturalHeight);
      imgRef.current = img;
      setImgLoaded(true);
    };
    img.src = src;
  }, [src]);

  // Calculate initial scale to cover the frame when image loads
  useEffect(() => {
    if (!imgLoaded || !containerRef.current) return;
    const container = containerRef.current;
    const frameW = container.clientWidth;
    const frameH = frameW / aspectRatio;

    // Scale so image covers the frame (like object-fit: cover)
    const scaleToFitW = frameW / naturalW;
    const scaleToFitH = frameH / naturalH;
    const coverScale = Math.max(scaleToFitW, scaleToFitH);

    setScale(coverScale);
    // Center the image
    setOffsetX((frameW - naturalW * coverScale) / 2);
    setOffsetY((frameH - naturalH * coverScale) / 2);
  }, [imgLoaded, naturalW, naturalH, aspectRatio]);

  const getFrameH = useCallback(() => {
    if (!containerRef.current) return 300;
    return containerRef.current.clientWidth / aspectRatio;
  }, [aspectRatio]);

  // Clamp offsets so the image always covers the frame
  const clampOffsets = useCallback(
    (ox: number, oy: number, s: number) => {
      if (!containerRef.current) return { x: ox, y: oy };
      const frameW = containerRef.current.clientWidth;
      const frameH = frameW / aspectRatio;
      const imgW = naturalW * s;
      const imgH = naturalH * s;

      // Image must cover frame: offset can't leave gaps
      const minX = frameW - imgW;
      const minY = frameH - imgH;
      return {
        x: Math.min(0, Math.max(minX, ox)),
        y: Math.min(0, Math.max(minY, oy)),
      };
    },
    [naturalW, naturalH, aspectRatio]
  );

  // Mouse/touch drag handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [offsetX, offsetY]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const clamped = clampOffsets(dragStart.current.ox + dx, dragStart.current.oy + dy, scale);
      setOffsetX(clamped.x);
      setOffsetY(clamped.y);
    },
    [scale, clampOffsets]
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Zoom with scroll wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (!containerRef.current) return;

      const frameW = containerRef.current.clientWidth;
      const frameH = frameW / aspectRatio;
      const minScale = Math.max(frameW / naturalW, frameH / naturalH);

      const delta = e.deltaY > 0 ? 0.95 : 1.05;
      const newScale = Math.max(minScale, Math.min(scale * delta, minScale * 5));

      // Zoom toward cursor position
      const rect = containerRef.current.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const newOx = cx - ((cx - offsetX) / scale) * newScale;
      const newOy = cy - ((cy - offsetY) / scale) * newScale;

      const clamped = clampOffsets(newOx, newOy, newScale);
      setScale(newScale);
      setOffsetX(clamped.x);
      setOffsetY(clamped.y);
    },
    [scale, offsetX, offsetY, naturalW, naturalH, aspectRatio, clampOffsets]
  );

  // Zoom buttons
  const handleZoom = useCallback(
    (direction: 1 | -1) => {
      if (!containerRef.current) return;
      const frameW = containerRef.current.clientWidth;
      const frameH = frameW / aspectRatio;
      const minScale = Math.max(frameW / naturalW, frameH / naturalH);

      const factor = direction === 1 ? 1.2 : 0.8;
      const newScale = Math.max(minScale, Math.min(scale * factor, minScale * 5));

      // Zoom toward center
      const cx = frameW / 2;
      const cy = frameH / 2;
      const newOx = cx - ((cx - offsetX) / scale) * newScale;
      const newOy = cy - ((cy - offsetY) / scale) * newScale;

      const clamped = clampOffsets(newOx, newOy, newScale);
      setScale(newScale);
      setOffsetX(clamped.x);
      setOffsetY(clamped.y);
    },
    [scale, offsetX, offsetY, naturalW, naturalH, aspectRatio, clampOffsets]
  );

  // Crop and output
  const handleConfirm = useCallback(() => {
    if (!imgRef.current || !containerRef.current) return;

    const frameW = containerRef.current.clientWidth;
    const frameH = frameW / aspectRatio;

    // Map visible frame back to source image coordinates
    const srcX = -offsetX / scale;
    const srcY = -offsetY / scale;
    const srcW = frameW / scale;
    const srcH = frameH / scale;

    const outputH = Math.round(outputWidth / aspectRatio);
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputH;

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(imgRef.current, srcX, srcY, srcW, srcH, 0, 0, outputWidth, outputH);

    canvas.toBlob(
      (blob) => {
        if (blob) onCrop(blob);
      },
      'image/jpeg',
      0.92
    );
  }, [offsetX, offsetY, scale, aspectRatio, outputWidth, onCrop]);

  if (!imgLoaded) {
    return (
      <div className="flex items-center justify-center h-48 bg-muted rounded-lg">
        <p className="text-sm text-muted-foreground">Loading image...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Move className="h-3.5 w-3.5" />
          Drag to reposition &middot; Scroll to zoom
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleZoom(-1)}
            className="p-1.5 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(1)}
            className="p-1.5 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Crop frame */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        className="relative overflow-hidden rounded-lg border-2 border-primary cursor-grab active:cursor-grabbing select-none touch-none"
        style={{ height: getFrameH() }}
      >
        <img
          src={src}
          alt="Crop preview"
          draggable={false}
          className="absolute pointer-events-none"
          style={{
            width: naturalW * scale,
            height: naturalH * scale,
            transform: `translate(${offsetX}px, ${offsetY}px)`,
            maxWidth: 'none',
          }}
        />
        {/* Corner indicators */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white/60 rounded-tl" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white/60 rounded-tr" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white/60 rounded-bl" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white/60 rounded-br" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          <X className="h-3.5 w-3.5 mr-1.5" />
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleConfirm}>
          <Check className="h-3.5 w-3.5 mr-1.5" />
          Confirm
        </Button>
      </div>
    </div>
  );
}

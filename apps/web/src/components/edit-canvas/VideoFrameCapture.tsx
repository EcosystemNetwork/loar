/**
 * VideoFrameCapture — scrubber + "Capture frame" button for video assets.
 *
 * On capture, renders the current video frame to a canvas, exports a JPEG
 * data URL, and hands it off to `session.captureFrame`. The captured frame
 * becomes the working surface for every image-based op in the session.
 */

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Camera, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { UseEditSessionResult } from '@/hooks/useEditSession';

export function VideoFrameCapture({
  videoUrl,
  session,
}: {
  videoUrl: string;
  session: UseEditSessionResult;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const capturedUrl = session.capturedFrameUrl;

  async function handleCapture() {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < 2) {
      toast.error('Video not ready yet');
      return;
    }
    setIsCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No canvas context');
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      await session.captureFrame({ frameDataUrl: dataUrl, time: video.currentTime });
      toast.success(`Frame captured at ${video.currentTime.toFixed(2)}s`);
    } catch (err: any) {
      toast.error(err?.message || 'Frame capture failed');
    } finally {
      setIsCapturing(false);
    }
  }

  async function handleClear() {
    try {
      await session.clearCapturedFrame();
      toast.success('Cleared captured frame');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to clear');
    }
  }

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="text-xs text-muted-foreground">
          Scrub to the frame you want to edit, then capture. Image ops run against the captured
          still — the new version is chained to this video as its parent.
        </div>
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          crossOrigin="anonymous"
          className="w-full rounded border border-border/40 max-h-[420px] bg-black"
        />
        <div className="flex gap-2">
          <Button
            onClick={handleCapture}
            disabled={isCapturing || !session.sessionId}
            className="flex-1"
          >
            {isCapturing ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Capturing…
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-1.5" />
                {capturedUrl ? 'Recapture frame' : 'Capture frame'}
              </>
            )}
          </Button>
          {capturedUrl && (
            <Button variant="outline" onClick={handleClear} disabled={isCapturing}>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Clear
            </Button>
          )}
        </div>
        {capturedUrl && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Active frame
            </div>
            <img
              src={capturedUrl}
              alt="captured frame"
              className="w-full rounded border border-primary/40"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

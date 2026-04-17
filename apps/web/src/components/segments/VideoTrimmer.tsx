/**
 * VideoTrimmer Component
 *
 * Lets users set in/out points on a video segment.
 * Shows a mini video preview with a dual-handle timeline
 * for selecting the portion of the video to keep.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Scissors, RotateCcw, Check } from 'lucide-react';
import type { VideoSegment } from '@/types/segments';

interface VideoTrimmerProps {
  segment: VideoSegment;
  onTrimChange: (segmentId: string, startTrimMs: number, endTrimMs: number) => void;
  onClose: () => void;
}

export function VideoTrimmer({ segment, onTrimChange, onClose }: VideoTrimmerProps) {
  const videoDurationMs = segment.duration * 1000;
  const [startMs, setStartMs] = useState(segment.startTrim ?? 0);
  const [endMs, setEndMs] = useState(segment.endTrim ?? videoDurationMs);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(segment.startTrim ?? 0);
  const [videoDurationActual, setVideoDurationActual] = useState(videoDurationMs);

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'start' | 'end' | null>(null);
  const rafRef = useRef<number>(0);

  const effectiveDurationMs = endMs - startMs;

  // Sync video currentTime when trim start changes (only when not playing)
  useEffect(() => {
    if (videoRef.current && !isPlaying) {
      videoRef.current.currentTime = startMs / 1000;
      setCurrentTimeMs(startMs);
    }
  }, [startMs]);

  // Monitor playback to enforce trim bounds
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      const ms = video.currentTime * 1000;
      setCurrentTimeMs(ms);

      if (ms >= endMs) {
        video.pause();
        video.currentTime = startMs / 1000;
        setCurrentTimeMs(startMs);
        setIsPlaying(false);
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
  }, [startMs, endMs]);

  // Set actual video duration once loaded
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoaded = () => {
      const actualMs = video.duration * 1000;
      if (isFinite(actualMs) && actualMs > 0) {
        setVideoDurationActual(actualMs);
        // If endTrim was never set, default to full duration
        if (!segment.endTrim) {
          setEndMs(actualMs);
        }
      }
    };

    video.addEventListener('loadedmetadata', onLoaded);
    // If already loaded
    if (video.duration && isFinite(video.duration)) {
      onLoaded();
    }
    return () => video.removeEventListener('loadedmetadata', onLoaded);
  }, [segment.videoUrl]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      // Start from trim start if we're outside the range
      const ms = video.currentTime * 1000;
      if (ms < startMs || ms >= endMs) {
        video.currentTime = startMs / 1000;
      }
      video.play();
      setIsPlaying(true);
    }
  }, [isPlaying, startMs, endMs]);

  const handleReset = useCallback(() => {
    setStartMs(0);
    setEndMs(videoDurationActual);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      setCurrentTimeMs(0);
    }
  }, [videoDurationActual]);

  const handleApply = useCallback(() => {
    onTrimChange(segment.id, startMs, endMs);
    onClose();
  }, [segment.id, startMs, endMs, onTrimChange, onClose]);

  // --- Drag logic for trim handles ---
  const getPositionFromEvent = useCallback(
    (clientX: number): number => {
      if (!trackRef.current) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(pct * videoDurationActual);
    },
    [videoDurationActual]
  );

  const handlePointerDown = useCallback(
    (handle: 'start' | 'end') => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = handle;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const ms = getPositionFromEvent(e.clientX);
      const minGap = 200; // 200ms minimum selection

      if (draggingRef.current === 'start') {
        setStartMs(Math.min(ms, endMs - minGap));
      } else {
        setEndMs(Math.max(ms, startMs + minGap));
      }
    },
    [getPositionFromEvent, startMs, endMs]
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  // Click on track to seek
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (draggingRef.current) return;
      const ms = getPositionFromEvent(e.clientX);
      const clamped = Math.max(startMs, Math.min(ms, endMs));
      if (videoRef.current) {
        videoRef.current.currentTime = clamped / 1000;
        setCurrentTimeMs(clamped);
      }
    },
    [getPositionFromEvent, startMs, endMs]
  );

  const formatTime = (ms: number) => {
    const totalSecs = ms / 1000;
    const mins = Math.floor(totalSecs / 60);
    const secs = Math.floor(totalSecs % 60);
    const tenths = Math.floor((totalSecs % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
  };

  const pct = (ms: number) => `${(ms / videoDurationActual) * 100}%`;

  return (
    <Card className="overflow-hidden">
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scissors className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Trim Video</span>
            <Badge variant="secondary" className="text-[10px]">
              {formatTime(effectiveDurationMs)} selected
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleReset}>
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={handleApply}>
              <Check className="h-3 w-3 mr-1" />
              Apply
            </Button>
          </div>
        </div>

        {/* Video Preview */}
        <div className="relative aspect-video bg-black rounded overflow-hidden max-h-48">
          <video
            ref={videoRef}
            src={segment.videoUrl}
            className="w-full h-full object-contain"
            playsInline
            muted
          />
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="bg-black/50 rounded-full p-3 hover:bg-black/70 transition-colors">
              {isPlaying ? (
                <Pause className="h-5 w-5 text-white" />
              ) : (
                <Play className="h-5 w-5 text-white ml-0.5" />
              )}
            </div>
          </button>

          {/* Time display */}
          <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 rounded text-[10px] text-white font-mono backdrop-blur-sm">
            {formatTime(currentTimeMs)} / {formatTime(videoDurationActual)}
          </div>
        </div>

        {/* Trim Timeline */}
        <div className="space-y-1">
          {/* Labels */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
            <span>In: {formatTime(startMs)}</span>
            <span>Out: {formatTime(endMs)}</span>
          </div>

          {/* Track */}
          <div
            ref={trackRef}
            className="relative h-10 bg-muted/30 rounded border cursor-pointer select-none"
            onClick={handleTrackClick}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Full duration background */}
            <div className="absolute inset-0 rounded overflow-hidden">
              {/* Dimmed regions outside trim */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-black/40"
                style={{ width: pct(startMs) }}
              />
              <div
                className="absolute top-0 bottom-0 right-0 bg-black/40"
                style={{ width: pct(videoDurationActual - endMs) }}
              />

              {/* Selected region */}
              <div
                className="absolute top-0 bottom-0 bg-primary/15 border-y border-primary/30"
                style={{ left: pct(startMs), width: pct(endMs - startMs) }}
              />
            </div>

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white z-10 pointer-events-none"
              style={{ left: pct(currentTimeMs) }}
            >
              <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rounded-full shadow" />
            </div>

            {/* Start handle */}
            <div
              className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-20 group"
              style={{ left: `calc(${pct(startMs)} - 6px)` }}
              onPointerDown={handlePointerDown('start')}
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 bg-primary rounded-full group-hover:w-1.5 transition-all" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-6 bg-primary rounded-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div className="w-0.5 h-3 bg-primary-foreground rounded-full" />
              </div>
            </div>

            {/* End handle */}
            <div
              className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-20 group"
              style={{ left: `calc(${pct(endMs)} - 6px)` }}
              onPointerDown={handlePointerDown('end')}
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 bg-primary rounded-full group-hover:w-1.5 transition-all" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-6 bg-primary rounded-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div className="w-0.5 h-3 bg-primary-foreground rounded-full" />
              </div>
            </div>
          </div>

          {/* Duration ruler */}
          <div className="flex items-center justify-between text-[9px] text-muted-foreground/60 font-mono">
            <span>0:00</span>
            <span>{formatTime(videoDurationActual)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * SelectionPlayer Component
 *
 * Fullscreen overlay that plays a sequence of videos from selected nodes
 * in the order they were selected on the timeline canvas.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  X,
  Maximize,
  Minimize,
  Loader2,
} from 'lucide-react';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

export interface SelectionVideo {
  nodeId: string;
  label: string;
  videoUrl: string;
}

interface SelectionPlayerProps {
  videos: SelectionVideo[];
  onClose: () => void;
}

export function SelectionPlayer({ videos, onClose }: SelectionPlayerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const current = videos[currentIndex];
  const hasNext = currentIndex < videos.length - 1;
  const hasPrevious = currentIndex > 0;

  // Overall progress across all videos
  const overallProgress = ((currentIndex + progress / 100) / videos.length) * 100;

  const handleEnded = useCallback(() => {
    if (hasNext) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setIsPlaying(false);
    }
  }, [hasNext]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const goToNext = useCallback(() => {
    if (hasNext) setCurrentIndex((prev) => prev + 1);
  }, [hasNext]);

  const goToPrevious = useCallback(() => {
    if (hasPrevious) setCurrentIndex((prev) => prev - 1);
  }, [hasPrevious]);

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    const total = videoRef.current.duration;
    setCurrentTime(cur);
    setDuration(total);
    if (total > 0) setProgress((cur / total) * 100);
  }, []);

  const handleSeek = useCallback(
    (value: number) => {
      if (!videoRef.current) return;
      const newTime = (value / 100) * duration;
      videoRef.current.currentTime = newTime;
      setProgress(value);
    },
    [duration]
  );

  const jumpToVideo = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  // Load new video when index changes
  useEffect(() => {
    if (!videoRef.current || !current) return;
    setIsLoading(true);
    setProgress(0);
    setCurrentTime(0);
    videoRef.current.load();

    const video = videoRef.current;
    const handleLoadedData = () => {
      setIsLoading(false);
      if (isPlaying) video.play();
    };
    video.addEventListener('loadeddata', handleLoadedData);
    return () => video.removeEventListener('loadeddata', handleLoadedData);
  }, [currentIndex, current?.videoUrl]);

  // Keyboard controls
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        goToNext();
      } else if (e.key === 'ArrowLeft') {
        goToPrevious();
      } else if (e.key === 'm') {
        toggleMute();
      } else if (e.key === 'f') {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, togglePlay, goToNext, goToPrevious, toggleMute, toggleFullscreen]);

  // Listen for fullscreen exit
  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!current) return null;

  return (
    <div ref={containerRef} className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/80 to-transparent p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge
            variant="secondary"
            className="backdrop-blur-sm bg-white/10 text-white border-white/20"
          >
            {currentIndex + 1} / {videos.length}
          </Badge>
          <span className="text-white/90 text-sm font-medium truncate max-w-xs">
            {current.label}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-white/70 hover:text-white hover:bg-white/10"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Video */}
      <div className="flex-1 flex items-center justify-center relative">
        <video
          ref={videoRef}
          src={resolveIpfsUrl(current.videoUrl)}
          onEnded={handleEnded}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleTimeUpdate}
          className="max-h-full max-w-full"
          playsInline
        />

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-16 w-16 animate-spin text-white/60" />
          </div>
        )}

        {!isPlaying && !isLoading && (
          <div
            className="absolute inset-0 flex items-center justify-center cursor-pointer"
            onClick={togglePlay}
          >
            <div className="bg-black/50 rounded-full p-6 hover:bg-black/70 transition-colors">
              <Play className="h-16 w-16 text-white" />
            </div>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/90 to-transparent pt-12 pb-4 px-4 space-y-3">
        {/* Overall multi-video progress */}
        <div className="flex gap-1">
          {videos.map((_, idx) => (
            <button
              key={idx}
              className={`flex-1 h-1 rounded-full transition-colors cursor-pointer hover:h-1.5 ${
                idx === currentIndex
                  ? 'bg-blue-500'
                  : idx < currentIndex
                    ? 'bg-blue-500/50'
                    : 'bg-white/20'
              }`}
              onClick={() => jumpToVideo(idx)}
              title={videos[idx].label}
            />
          ))}
        </div>

        {/* Current video seek bar */}
        <div className="flex items-center gap-3">
          <span className="text-white/60 text-xs w-10 text-right">{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max="100"
            value={progress}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="flex-1 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          />
          <span className="text-white/60 text-xs w-10">{formatTime(duration)}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white/70 hover:text-white hover:bg-white/10"
              onClick={goToPrevious}
              disabled={!hasPrevious}
            >
              <SkipBack className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10 h-12 w-12"
              onClick={togglePlay}
              disabled={isLoading}
            >
              {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="text-white/70 hover:text-white hover:bg-white/10"
              onClick={goToNext}
              disabled={!hasNext}
            >
              <SkipForward className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white/70 hover:text-white hover:bg-white/10"
              onClick={toggleMute}
            >
              {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="text-white/70 hover:text-white hover:bg-white/10"
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

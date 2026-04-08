import { Play, Pause, Maximize, Minimize } from 'lucide-react';
import { useState } from 'react';

export function PlayerControls({
  isPlaying,
  progress,
  onTogglePlay,
  onSeek,
}: {
  isPlaying: boolean;
  progress: number;
  onTogglePlay: () => void;
  onSeek: (percent: number) => void;
}) {
  const [isVisible, setIsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 z-10 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => isPlaying && setIsVisible(false)}
    >
      <div className="bg-gradient-to-t from-black/80 to-transparent pt-16 pb-4 px-4">
        {/* Progress bar */}
        <div
          role="slider"
          aria-label="Seek position"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer group mb-4"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') onSeek(Math.max(0, progress - 5));
            if (e.key === 'ArrowRight') onSeek(Math.min(100, progress + 5));
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = ((e.clientX - rect.left) / rect.width) * 100;
            onSeek(pct);
          }}
        >
          <div
            className="h-full bg-violet-500 rounded-full relative group-hover:bg-violet-400 transition-colors"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <button
            onClick={onTogglePlay}
            className="p-2 text-white/80 hover:text-white transition-colors"
          >
            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2 text-white/80 hover:text-white transition-colors"
          >
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

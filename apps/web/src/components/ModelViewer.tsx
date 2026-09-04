/**
 * ModelViewer — interactive 3D model viewer using Google's <model-viewer>.
 *
 * Renders GLB/GLTF files with orbit controls, auto-rotate, and AR support.
 * Falls back gracefully if the poster (thumbnail) is provided.
 *
 * Pass `testbench` to surface animation/lighting controls — used by the wiki
 * 3D-models dialog so creators can preview baked animations, tweak exposure,
 * and toggle auto-rotate without leaving the page.
 */
import '@google/model-viewer';
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, Maximize2, Minimize2, Play, Pause, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getIpfsUrlCandidatesPreferred, raceIpfsGateways } from '@/utils/ipfs-url';

// GLB loads can hang indefinitely against a rate-limited/offline gateway: a
// 429/504 doesn't always surface as a clean `error` event on <model-viewer>
// (the browser sometimes just stalls the request), so `error` alone leaves
// the viewer spinning forever with no recovery — same failure mode
// MediaLightbox already guards against for video/audio. Race the stall timer
// against a real `load` event and advance to the next gateway either way.
const STALL_MS = 10000;

interface ModelViewerProps {
  /** URL to the GLB/GLTF model */
  src: string;
  /** Optional poster image shown while loading */
  poster?: string;
  /** Alt text */
  alt?: string;
  /** CSS class for the container */
  className?: string;
  /** Whether to allow fullscreen */
  allowFullscreen?: boolean;
  /** Show animation/lighting controls when the model exposes animations or you want a richer preview. */
  testbench?: boolean;
}

export function ModelViewer({
  src,
  poster,
  alt = '3D Model',
  className = '',
  allowFullscreen = true,
  testbench = false,
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const modelElRef = useRef<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [animations, setAnimations] = useState<string[]>([]);
  const [currentAnimation, setCurrentAnimation] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [exposure, setExposure] = useState(1);

  // Same gateway fallback chain SmartImage/MediaLightbox already use for
  // images and video — `src` here can be a raw ipfs:// URL or an
  // already-resolved gateway URL either way, extractIpfsPath() recognizes both.
  const srcCandidates = useMemo(() => getIpfsUrlCandidatesPreferred(src), [src]);
  const [orderedCandidates, setOrderedCandidates] = useState<string[]>(srcCandidates);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
    setOrderedCandidates(srcCandidates);
    if (srcCandidates.length <= 1) return;

    let cancelled = false;
    const controller = new AbortController();
    raceIpfsGateways(src, { signal: controller.signal, timeoutMs: 2500 })
      .then((best) => {
        if (cancelled || !best) return;
        setOrderedCandidates((prev) => [best, ...prev.filter((c) => c !== best)]);
      })
      .catch(() => {
        /* race failed — orderedCandidates still has the sync fallback chain */
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `srcCandidates` is a derived memo keyed on `src`; keying this effect on
    // `src` avoids re-racing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const resolvedSrc = orderedCandidates[candidateIndex] || src;

  const handleLoadError = useCallback(() => {
    setCandidateIndex((i) => (i + 1 < orderedCandidates.length ? i + 1 : i));
  }, [orderedCandidates]);

  useEffect(() => {
    if (!viewerRef.current) return;
    setLoading(true);
    const el = document.createElement('model-viewer') as any;
    el.setAttribute('src', resolvedSrc);
    if (poster) el.setAttribute('poster', poster);
    el.setAttribute('alt', alt);
    el.setAttribute('camera-controls', '');
    if (autoRotate) el.setAttribute('auto-rotate', '');
    el.setAttribute('shadow-intensity', '1');
    el.setAttribute('tone-mapping', 'neutral');
    el.setAttribute('exposure', String(exposure));
    el.setAttribute('touch-action', 'pan-y');
    el.setAttribute('interaction-prompt', 'auto');
    el.setAttribute('loading', 'lazy');
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.minHeight = '300px';

    el.addEventListener('load', () => {
      clearTimeout(stallTimer);
      setLoading(false);
      // availableAnimations is populated after the GLB is parsed. Empty array
      // for static meshes — the controls hide themselves in that case.
      const available: string[] = Array.isArray(el.availableAnimations)
        ? el.availableAnimations
        : [];
      setAnimations(available);
      if (available.length > 0) {
        setCurrentAnimation(available[0]);
        el.animationName = available[0];
        if (testbench) {
          // Don't autoplay until the user clicks; static-mesh users would just
          // see a frozen model and wonder why the play button is dim.
          setIsPlaying(false);
        }
      }
    });
    // A rate-limited/offline gateway (429/504) fires this reliably when the
    // browser does surface it — advance to the next candidate rather than
    // leaving the viewer stuck on a dead gateway.
    el.addEventListener('error', handleLoadError);

    viewerRef.current.innerHTML = '';
    viewerRef.current.appendChild(el);
    modelElRef.current = el;

    const stallTimer = setTimeout(handleLoadError, STALL_MS);

    return () => {
      clearTimeout(stallTimer);
      el.removeEventListener('error', handleLoadError);
      el.remove();
      modelElRef.current = null;
    };
    // We intentionally exclude autoRotate/exposure — those are imperatively
    // applied below so the model doesn't tear down and reload on every tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedSrc, poster, alt, testbench, handleLoadError]);

  // Reflect testbench control changes onto the live element without rebuilding.
  useEffect(() => {
    const el = modelElRef.current;
    if (!el) return;
    if (autoRotate) el.setAttribute('auto-rotate', '');
    else el.removeAttribute('auto-rotate');
  }, [autoRotate]);

  useEffect(() => {
    const el = modelElRef.current;
    if (!el) return;
    el.setAttribute('exposure', String(exposure));
  }, [exposure]);

  useEffect(() => {
    const el = modelElRef.current;
    if (!el || !currentAnimation) return;
    el.animationName = currentAnimation;
    if (isPlaying) el.play();
  }, [currentAnimation, isPlaying]);

  const togglePlay = () => {
    const el = modelElRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      el.play();
      setIsPlaying(true);
    }
  };

  const resetCamera = () => {
    const el = modelElRef.current;
    if (!el) return;
    el.cameraOrbit = 'auto auto auto';
    el.cameraTarget = 'auto auto auto';
    el.fieldOfView = 'auto';
    el.resetTurntableRotation?.();
    el.jumpCameraToGoal?.();
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative rounded-lg overflow-hidden bg-muted/30 border ${className}`}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-muted/50">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      <div ref={viewerRef} className="w-full h-full" />

      <div className="absolute top-2 right-2 flex gap-1">
        {allowFullscreen && (
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7 bg-background/80 backdrop-blur-sm"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </Button>
        )}
      </div>

      {testbench && !loading && (
        <div className="absolute bottom-2 left-2 right-2 flex flex-wrap items-center gap-2 rounded-md bg-background/80 backdrop-blur-sm px-2 py-1.5 text-xs">
          {animations.length > 0 ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={togglePlay}
                title={isPlaying ? 'Pause animation' : 'Play animation'}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </Button>
              {animations.length > 1 ? (
                <Select
                  value={currentAnimation ?? undefined}
                  onValueChange={(v) => setCurrentAnimation(v)}
                >
                  <SelectTrigger className="h-7 w-40 text-xs">
                    <SelectValue placeholder="Animation" />
                  </SelectTrigger>
                  <SelectContent>
                    {animations.map((name) => (
                      <SelectItem key={name} value={name} className="text-xs">
                        {name || '(unnamed)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-muted-foreground truncate max-w-[10rem]">
                  {currentAnimation || 'animation'}
                </span>
              )}
              <span className="text-muted-foreground/60">·</span>
            </>
          ) : (
            <span className="text-muted-foreground italic">No baked animations</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setAutoRotate((v) => !v)}
          >
            {autoRotate ? 'Spin: on' : 'Spin: off'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={resetCamera}
            title="Reset camera"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
          <label className="flex items-center gap-1.5 ml-auto text-muted-foreground">
            <span>Exposure</span>
            <input
              type="range"
              min={0.2}
              max={2}
              step={0.1}
              value={exposure}
              onChange={(e) => setExposure(parseFloat(e.target.value))}
              className="w-20 accent-primary"
            />
          </label>
        </div>
      )}
    </div>
  );
}

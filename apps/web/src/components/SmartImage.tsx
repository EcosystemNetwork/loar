import { useEffect, useMemo, useRef, useState } from 'react';
import { decode as decodeBlurhash } from 'blurhash';
import { cn } from '@/lib/utils';
import { getIpfsUrlCandidatesPreferred, raceIpfsGateways } from '@/utils/ipfs-url';
import { Skeleton } from '@/components/ui/skeleton';

export interface SmartImageProps extends Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'srcSet' | 'sizes' | 'loading'
> {
  /** Source URL — IPFS, HTTPS, or `ipfs://`. Falls back through gateways on error. */
  src?: string | null;
  alt: string;
  /** Optional blurhash placeholder — replaces the skeleton when supplied. */
  blurhash?: string;
  /** Optional pre-resolved sizes attr to pair with the resize-proxy srcset. */
  sizes?: string;
  /**
   * Eager-load — set on hero/above-fold imagery. Defaults to lazy.
   */
  priority?: boolean;
  /**
   * Render the placeholder/image inside an aspect-ratio wrapper to prevent
   * layout shift. Pass any tailwind aspect class (e.g. `aspect-video`) or use
   * the convenience `aspect` prop.
   */
  aspect?: 'video' | 'square' | 'portrait' | 'wide';
  /** Skip the resize proxy (e.g. for SVGs or already-optimized assets). */
  unoptimized?: boolean;
}

const RESIZE_WIDTHS = [320, 480, 640, 960, 1280, 1600];

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');

/**
 * Build a srcset pointing at the server resize proxy. The proxy returns a
 * resized + format-negotiated image (`?url=...&w=...&format=auto`). We omit
 * srcset entirely if the server URL isn't configured — the bare src still
 * works through the IPFS gateway directly.
 */
function buildResizeSrcSet(src: string): string | undefined {
  if (!SERVER_URL) return undefined;
  return RESIZE_WIDTHS.map(
    (w) => `${SERVER_URL}/api/img?url=${encodeURIComponent(src)}&w=${w} ${w}w`
  ).join(', ');
}

const ASPECT_CLASS: Record<NonNullable<SmartImageProps['aspect']>, string> = {
  video: 'aspect-video',
  square: 'aspect-square',
  portrait: 'aspect-[3/4]',
  wide: 'aspect-[21/9]',
};

/**
 * SmartImage — lazy, gateway-aware image component with skeleton/blurhash
 * placeholder, fade-in, and graceful onError fallback through the IPFS
 * candidate chain. Wraps a native `<img>` so existing CSS/layout still works.
 */
export function SmartImage({
  src,
  alt,
  className,
  blurhash,
  sizes,
  priority = false,
  aspect,
  unoptimized = false,
  onLoad,
  onError,
  ...rest
}: SmartImageProps) {
  const candidates = useMemo(() => getIpfsUrlCandidatesPreferred(src || ''), [src]);
  // Ordered fallback chain, re-headed to whichever gateway raceIpfsGateways
  // finds live/fastest — see the racing effect below. Starts as `candidates`
  // and gets reordered once the race settles.
  const [orderedCandidates, setOrderedCandidates] = useState<string[]>(candidates);
  const [candidateIdx, setCandidateIdx] = useState(0);
  // True while we're probing gateways in parallel before committing a src.
  // Skipped entirely when there's nothing to race (single candidate, e.g. a
  // plain non-IPFS URL) so non-IPFS images never pay the probe round trip.
  const [racing, setRacing] = useState(candidates.length > 1);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const activeSrc = racing ? '' : orderedCandidates[candidateIdx] || '';

  useEffect(() => {
    setOrderedCandidates(candidates);
    setCandidateIdx(0);
    setLoaded(false);
    setErrored(false);

    if (candidates.length <= 1) {
      setRacing(false);
      return;
    }

    // Race the candidate gateways (HEAD, in parallel) so we commit `src` to
    // whichever one is verified live and fastest, instead of starting on the
    // primary and waiting for a native `onerror` — which never fires on a
    // hang, only a hard failure, and a stalled public gateway can hang for
    // 20s+ before that happens.
    setRacing(true);
    let cancelled = false;
    const controller = new AbortController();
    raceIpfsGateways(src, { signal: controller.signal, timeoutMs: 2500 })
      .then((best) => {
        if (cancelled || !best) return;
        setOrderedCandidates((prev) => [best, ...prev.filter((c) => c !== best)]);
      })
      .finally(() => {
        if (!cancelled) setRacing(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `candidates` is a derived memo keyed on `src`; keying this effect on
    // `src` avoids re-racing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const handleError: React.ReactEventHandler<HTMLImageElement> = (e) => {
    if (candidateIdx + 1 < orderedCandidates.length) {
      setCandidateIdx(candidateIdx + 1);
    } else {
      setErrored(true);
    }
    onError?.(e);
  };

  const handleLoad: React.ReactEventHandler<HTMLImageElement> = (e) => {
    setLoaded(true);
    onLoad?.(e);
  };

  const srcSet = !unoptimized && activeSrc ? buildResizeSrcSet(activeSrc) : undefined;

  const wrapperClass = cn(
    'relative overflow-hidden',
    aspect ? ASPECT_CLASS[aspect] : undefined,
    className
  );

  if (!src || errored) {
    return (
      <div className={wrapperClass}>
        <div className="absolute inset-0 bg-muted flex items-center justify-center text-muted-foreground/40 text-xs">
          {errored ? 'Couldn’t load image' : ''}
        </div>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      {!loaded &&
        (blurhash ? (
          <BlurhashCanvas hash={blurhash} />
        ) : (
          <Skeleton className="absolute inset-0 rounded-none" />
        ))}
      {activeSrc && (
        <img
          {...rest}
          src={activeSrc}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}
    </div>
  );
}

/**
 * Blurhash placeholder rendered into a tiny canvas. Rendered absolutely so
 * the host wrapper controls layout. Stays mounted until the real image
 * fades in over it.
 */
function BlurhashCanvas({ hash }: { hash: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const w = 32;
      const h = 32;
      const pixels = decodeBlurhash(hash, w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imgData = ctx.createImageData(w, h);
      imgData.data.set(pixels);
      ctx.putImageData(imgData, 0, 0);
    } catch {
      // Bad hash — fall through to skeleton.
    }
  }, [hash]);
  return (
    <canvas
      ref={canvasRef}
      width={32}
      height={32}
      className="absolute inset-0 w-full h-full"
      aria-hidden
    />
  );
}

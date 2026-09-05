import { useEffect, useMemo, useRef, useState } from 'react';
import { decode as decodeBlurhash } from 'blurhash';
import { cn } from '@/lib/utils';
import {
  getIpfsUrlCandidatesPreferred,
  isIpfsGatewayUrl,
  raceIpfsGateways,
} from '@/utils/ipfs-url';
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
 * srcset entirely if the server URL isn't configured, or if `src` isn't a
 * recognized IPFS gateway URL — the proxy's SSRF guard 400s
 * ("host not allowed") on anything else (e.g. a plain https:// placeholder
 * cover image), and an errored srcset candidate fails the whole <img> with
 * no bare-`src` fallback (see handleError below). Mirrors the same guard in
 * `utils/img-proxy.ts`'s `proxyable()`.
 */
function buildResizeSrcSet(src: string): string | undefined {
  if (!SERVER_URL || !isIpfsGatewayUrl(src)) return undefined;
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
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  // Flipped once the visible <img> has fired load or error. The background
  // gateway race below stops reordering `src` out from under a settled image
  // — an upgrade only helps while the primary is still stalled.
  const settledRef = useRef(false);

  const activeSrc = orderedCandidates[candidateIdx] || '';

  useEffect(() => {
    setOrderedCandidates(candidates);
    setCandidateIdx(0);
    setLoaded(false);
    setErrored(false);
    settledRef.current = false;

    if (candidates.length <= 1) return;

    // Render `candidates[0]` immediately (the dedicated CDN gateway once
    // primeIpfsGatewayConfig has landed — fast and reliable) and race the
    // rest in the background. If the primary stalls — a native `onerror`
    // never fires on a hang, only a hard failure, and a degraded public
    // gateway can hang for 20s+ — the race swaps in a verified-live gateway
    // before that timeout.
    let cancelled = false;
    const controller = new AbortController();
    raceIpfsGateways(src, { signal: controller.signal, timeoutMs: 2500 })
      .then((best) => {
        if (cancelled || !best || settledRef.current) return;
        setOrderedCandidates((prev) => {
          if (prev[0] === best) return prev;
          return [best, ...prev.filter((c) => c !== best)];
        });
        setCandidateIdx(0);
      })
      .catch(() => {
        /* race falls through to the sync pick already rendering */
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
    // A failure that advances to the next candidate keeps the race relevant
    // (the new src might stall too); exhausting the chain settles it.
    if (candidateIdx + 1 < orderedCandidates.length) {
      setCandidateIdx(candidateIdx + 1);
    } else {
      settledRef.current = true;
      setErrored(true);
    }
    onError?.(e);
  };

  const handleLoad: React.ReactEventHandler<HTMLImageElement> = (e) => {
    settledRef.current = true;
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
          // Tells the global onerror gateway-rotator (install-ipfs-fallback.ts)
          // to leave this element alone — SmartImage already owns a full
          // candidate-chain retry via handleError below. Without this, the
          // capture-phase global listener fires first on every failure,
          // silently rewrites `src` and calls stopImmediatePropagation(),
          // and desyncs from React's `candidateIdx` (which never advances) —
          // both burning down the shared MAX_HOPS budget until they exhaust
          // it before every real gateway has actually been tried, showing
          // "Couldn't load image" even though live gateways remained.
          data-smart-image="true"
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

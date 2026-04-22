import { getNextIpfsFallback, isIpfsGatewayUrl } from './ipfs-url';

// Max hops per element — we have 3 public fallbacks after the primary.
const MAX_HOPS = 4;
const HOP_ATTR = 'data-ipfs-hops';

function advance(el: HTMLImageElement | HTMLVideoElement | HTMLSourceElement): boolean {
  const maybeCurrentSrc = (el as HTMLImageElement | HTMLVideoElement).currentSrc;
  const current = el.getAttribute('src') || maybeCurrentSrc || '';
  if (!isIpfsGatewayUrl(current)) return false;
  const hops = Number(el.getAttribute(HOP_ATTR) || '0');
  if (hops >= MAX_HOPS) return false;
  const next = getNextIpfsFallback(current);
  if (!next) return false;
  el.setAttribute(HOP_ATTR, String(hops + 1));
  el.setAttribute('src', next);
  if (el.tagName === 'VIDEO' || el.tagName === 'SOURCE') {
    // <video>/<source> needs load() to re-evaluate src.
    const video = (el.tagName === 'VIDEO' ? el : el.parentElement) as HTMLVideoElement | null;
    try {
      video?.load();
    } catch {
      // noop
    }
  }
  return true;
}

let installed = false;

export function installGlobalIpfsFallback(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  // Capture phase so we run before React-level handlers. The 'error' event
  // does not bubble for <img>/<video>, so capture is required.
  document.addEventListener(
    'error',
    (event) => {
      const target = event.target as Element | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag !== 'IMG' && tag !== 'VIDEO' && tag !== 'SOURCE') return;
      advance(target as HTMLImageElement | HTMLVideoElement | HTMLSourceElement);
    },
    true
  );
}

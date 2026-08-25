import { getNextIpfsFallback, isIpfsGatewayUrl } from './ipfs-url';

// Max hops per element — up to 4 public fallbacks after the primary, plus
// one extra hop of headroom for the dedicated gateway landing mid-chain once
// its async resolve completes (see getIpfsUrlCandidatesPreferred).
const MAX_HOPS = 6;
const HOP_ATTR = 'data-ipfs-hops';

function advance(el: HTMLImageElement | HTMLVideoElement | HTMLSourceElement): boolean {
  // SmartImage owns its own React-state candidate chain and onError handler.
  // If we also rotate this element's `src` here, we do it out from under
  // React (direct DOM mutation + stopImmediatePropagation), desyncing
  // SmartImage's `candidateIdx` from what's actually loaded and burning the
  // shared MAX_HOPS budget on hops React doesn't know happened — see the
  // comment on SmartImage's <img data-smart-image>.
  if (el.getAttribute('data-smart-image') === 'true') return false;
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
      const advanced = advance(target as HTMLImageElement | HTMLVideoElement | HTMLSourceElement);
      // When we successfully rotate to the next gateway, stop the same error
      // event from reaching the element's own onError (e.g. ContentCard's
      // fallback to /placeholder.jpg) — otherwise React's handler clobbers
      // the new src before the fallback gateway can even be tried.
      if (advanced) event.stopImmediatePropagation();
    },
    true
  );
}

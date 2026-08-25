import { useEffect, useState } from 'react';
import { getIpfsUrlCandidatesPreferred, raceIpfsGateways } from '@/utils/ipfs-url';

/**
 * Resolves an IPFS (or passthrough) URL to the fastest/most-reliable gateway,
 * racing candidates in the background and upgrading once a winner lands.
 *
 * For elements SmartImage can wrap (<img>), its own onError chain already
 * handles gateway fallback. This hook exists for call sites that can't use
 * SmartImage — chiefly native <video poster>, which browsers do not
 * reliably fire an `error` event for on a failed load (unlike <img>/<video
 * src>, which install-ipfs-fallback.ts's global onerror rotator already
 * covers) — so a stalled/degraded gateway on the sync pick would otherwise
 * leave the poster blank with no way to recover.
 */
export function useResolvedIpfsUrl(url?: string | null): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(
    () => getIpfsUrlCandidatesPreferred(url)[0] || undefined
  );

  useEffect(() => {
    setResolved(getIpfsUrlCandidatesPreferred(url)[0] || undefined);
    if (!url) return;
    let cancelled = false;
    const controller = new AbortController();
    raceIpfsGateways(url, { signal: controller.signal, timeoutMs: 2500 })
      .then((best) => {
        if (!cancelled && best) setResolved(best);
      })
      .catch(() => {
        /* race falls through to the sync pick already set above */
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url]);

  return resolved;
}

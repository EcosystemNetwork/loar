import { useCallback } from 'react';

/**
 * Reads and writes a universe's locally-cached event data — titles,
 * descriptions, resolved media URLs, and per-scene generation context,
 * keyed by event id under `universe_events_${universeId}` in localStorage.
 *
 * This is the single place that parses that blob, so a corrupt or partial
 * write degrades to an empty object instead of throwing out of whatever
 * handler touched it. Extracted from the universe timeline editor, which
 * previously duplicated the read-parse-fallback pattern at ~11 call sites.
 */
export function useUniverseEvents(universeId: string) {
  const getStoredEvents = useCallback((): Record<string, any> => {
    try {
      const stored = localStorage.getItem(`universe_events_${universeId}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }, [universeId]);

  const setStoredEvents = useCallback(
    (events: Record<string, any>) => {
      localStorage.setItem(`universe_events_${universeId}`, JSON.stringify(events));
    },
    [universeId]
  );

  return { getStoredEvents, setStoredEvents };
}

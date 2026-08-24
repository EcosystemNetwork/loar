import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

const SAVE_DEBOUNCE_MS = 800;

/**
 * Reads and writes a universe's cached event data — titles, descriptions,
 * resolved media URLs, and per-scene generation context, keyed by event id
 * under `universe_events_${universeId}` in localStorage.
 *
 * localStorage stays the synchronous read/write path — the timeline editor
 * reads, mutates, and writes back the whole map in a single tick at ~11
 * call sites, so making that async would ripple through all of them. On top
 * of that, every write is mirrored (debounced, diffed against the last
 * write so only changed/removed event ids go over the wire) to the
 * `universeEvents` server collection, so scene data survives a cleared
 * cache, a different device, or a teammate opening the same universe —
 * previously it lived in localStorage only and was lost in all three cases.
 * On first load for a universe, if localStorage is empty (fresh browser/
 * device) the server copy seeds it; an existing local cache is trusted
 * as-is rather than risk resurrecting something deleted locally that
 * hasn't finished syncing yet.
 *
 * This is the single place that parses that blob, so a corrupt or partial
 * write degrades to an empty object instead of throwing out of whatever
 * handler touched it. Extracted from the universe timeline editor, which
 * previously duplicated the read-parse-fallback pattern at ~11 call sites.
 */
export function useUniverseEvents(universeId: string) {
  const storageKey = `universe_events_${universeId}`;

  const getStoredEvents = useCallback((): Record<string, any> => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }, [storageKey]);

  const upsertMutation = useMutation({
    mutationFn: (patch: Record<string, Record<string, any> | null>) =>
      trpcClient.universeEvents.upsert.mutate({ universeId, events: patch }),
  });

  // `lastSyncedRef` is the last event map the server is believed to hold
  // (seeded from the initial hydration, advanced on every local write) —
  // the diff base for turning a full setStoredEvents() call into a minimal
  // patch. `pendingPatchRef` accumulates that patch across a debounce
  // window so a burst of edits sends one request instead of one per call.
  const lastSyncedRef = useRef<Record<string, any>>({});
  const pendingPatchRef = useRef<Record<string, Record<string, any> | null>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};
    if (Object.keys(patch).length === 0 || !universeId) return;
    upsertMutation.mutate(patch);
  }, [universeId, upsertMutation]);

  const setStoredEvents = useCallback(
    (events: Record<string, any>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(events));
      } catch {
        // best-effort — the debounced server push below is the durable copy
      }

      const prev = lastSyncedRef.current;
      const patch = { ...pendingPatchRef.current };
      for (const key of Object.keys(events)) {
        if (JSON.stringify(events[key]) !== JSON.stringify(prev[key])) {
          patch[key] = events[key];
        }
      }
      for (const key of Object.keys(prev)) {
        if (!(key in events)) patch[key] = null; // deleted — clears it server-side
      }
      pendingPatchRef.current = patch;
      lastSyncedRef.current = events;

      if (Object.keys(patch).length === 0) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [storageKey, flush]
  );

  // Flush a pending patch on unmount so a quick nav-away doesn't drop it.
  useEffect(() => flush, [flush]);

  const hydratedRef = useRef<string | null>(null);
  const serverQuery = useQuery({
    queryKey: ['universeEvents', universeId],
    queryFn: () => trpcClient.universeEvents.get.query({ universeId }),
    enabled: !!universeId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!serverQuery.data || hydratedRef.current === universeId) return;
    hydratedRef.current = universeId;
    const serverEvents = (serverQuery.data.events ?? {}) as Record<string, any>;
    lastSyncedRef.current = serverEvents;

    const local = getStoredEvents();
    if (Object.keys(local).length === 0 && Object.keys(serverEvents).length > 0) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(serverEvents));
      } catch {
        // best-effort
      }
    }
  }, [serverQuery.data, universeId, storageKey, getStoredEvents]);

  return { getStoredEvents, setStoredEvents };
}

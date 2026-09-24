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

  // `pendingPatchRef` accumulates the patch across a debounce window so a
  // burst of edits sends one request instead of one per call.
  //
  // The patch is diffed against what THIS browser held locally *before* the
  // write — not against the last server copy. Diffing against the server made
  // every stale local entry (one a teammate has since edited) look "changed"
  // on the next unrelated save, so it was pushed back and silently clobbered
  // their edit. Callers mutate the map returned by getStoredEvents() and pass
  // it back, but getStoredEvents() re-parses storage on each call, so storage
  // still holds the pre-mutation state here.
  const pendingPatchRef = useRef<Record<string, Record<string, any> | null>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `useMutation` returns a brand-new result object on EVERY render, so
  // depending on it (or on `upsertMutation`) would give `flush` — and through
  // it `setStoredEvents` — a new identity each render. The editor lists
  // setStoredEvents in the deps of its delete/regenerate/switch-version
  // handlers, which in turn are deps of the effect that rebuilds every canvas
  // node with setNodes(): so each render re-ran the rebuild, which re-rendered,
  // ~170x/sec. Every rebuild discards ReactFlow's measured node dimensions, so
  // no node was ever marked initialized and the whole canvas stayed
  // `visibility: hidden` ("nodes disappear when I open the editor"). Read the
  // mutate fn through a ref so the callbacks stay referentially stable.
  const mutateRef = useRef(upsertMutation.mutate);
  mutateRef.current = upsertMutation.mutate;

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};
    if (Object.keys(patch).length === 0 || !universeId) return;
    mutateRef.current(patch);
  }, [universeId]);

  const setStoredEvents = useCallback(
    (events: Record<string, any>) => {
      const prev = getStoredEvents();
      try {
        localStorage.setItem(storageKey, JSON.stringify(events));
      } catch {
        // best-effort — the debounced server push below is the durable copy
      }

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

      if (Object.keys(patch).length === 0) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [storageKey, flush, getStoredEvents]
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

    const local = getStoredEvents();
    if (Object.keys(local).length === 0 && Object.keys(serverEvents).length > 0) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(serverEvents));
      } catch {
        // best-effort
      }
      return;
    }

    // An existing local cache is trusted (see the header comment), except that
    // an entry a collaborator has edited since — a strictly newer server
    // `timestamp` — replaces the stale local copy. Only keys present on both
    // sides are touched, so a local delete that hasn't synced can't resurrect.
    let merged: Record<string, any> | null = null;
    for (const key of Object.keys(local)) {
      const srv = serverEvents[key];
      if (srv && (srv.timestamp ?? 0) > (local[key]?.timestamp ?? 0)) {
        merged ??= { ...local };
        merged[key] = srv;
      }
    }
    if (merged) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(merged));
      } catch {
        // best-effort
      }
    }
  }, [serverQuery.data, universeId, storageKey, getStoredEvents]);

  return { getStoredEvents, setStoredEvents };
}

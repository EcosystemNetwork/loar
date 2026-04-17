/**
 * useCollaborativeEntity — Real-time collaborative entity editing.
 *
 * Manages an SSE connection for live updates, field locking, presence,
 * and debounced field updates.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import type { Entity } from '@/hooks/useEntities';

export interface ActiveEditor {
  sessionId: string;
  userId: string;
  displayName: string;
  activeField: string | null;
  walletAddress: string | null;
}

export interface LockedField {
  userId: string;
  displayName: string;
}

interface UseCollaborativeEntityProps {
  entityId: string;
  enabled?: boolean;
  displayName?: string;
}

interface UseCollaborativeEntityReturn {
  entity: Entity | null;
  editors: ActiveEditor[];
  lockedFields: Record<string, LockedField>;
  isConnected: boolean;
  sessionId: string | null;
  updateField: (fieldPath: string, value: string | number | boolean | null) => void;
  lockField: (fieldPath: string) => Promise<boolean>;
  unlockField: (fieldPath: string) => Promise<void>;
  editHistory: Array<{
    id: string;
    userId: string;
    fieldPath: string;
    oldValue: any;
    newValue: any;
    timestamp: string;
  }>;
}

export function useCollaborativeEntity({
  entityId,
  enabled = true,
  displayName,
}: UseCollaborativeEntityProps): UseCollaborativeEntityReturn {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [editors, setEditors] = useState<ActiveEditor[]>([]);
  const [lockedFields, setLockedFields] = useState<Record<string, LockedField>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [editHistory, setEditHistory] = useState<any[]>([]);

  const sessionIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const queryClient = useQueryClient();

  // Join session on mount
  useEffect(() => {
    if (!enabled || !entityId) return;

    let cancelled = false;

    const joinAndConnect = async () => {
      try {
        // Join the editing session
        const result = await trpcClient.collaboration.joinSession.mutate({
          entityId,
          displayName,
        });

        if (cancelled) return;

        sessionIdRef.current = result.sessionId;
        setSessionId(result.sessionId);

        // Connect SSE stream
        const serverUrl = import.meta.env.VITE_SERVER_URL || '';
        const evtSource = new EventSource(`${serverUrl}/api/collaboration/stream/${entityId}`, {
          withCredentials: true,
        });

        eventSourceRef.current = evtSource;

        evtSource.addEventListener('connected', () => {
          setIsConnected(true);
        });

        evtSource.addEventListener('entity_update', (e) => {
          try {
            const data = JSON.parse(e.data);
            setEntity(data as Entity);
          } catch {
            // Parse error
          }
        });

        evtSource.addEventListener('presence', (e) => {
          try {
            const data = JSON.parse(e.data);
            setEditors(data.editors || []);
          } catch {
            // Parse error
          }
        });

        evtSource.addEventListener('locks', (e) => {
          try {
            const data = JSON.parse(e.data);
            setLockedFields(data.lockedFields || {});
          } catch {
            // Parse error
          }
        });

        evtSource.onerror = () => {
          setIsConnected(false);
        };

        // Heartbeat every 30s
        heartbeatRef.current = setInterval(async () => {
          if (sessionIdRef.current) {
            try {
              await trpcClient.collaboration.heartbeat.mutate({
                sessionId: sessionIdRef.current,
              });
            } catch {
              // Heartbeat failed — session may be stale
            }
          }
        }, 30_000);

        // Load edit history
        try {
          const history = await trpcClient.collaboration.getEditHistory.query({
            entityId,
            limit: 30,
          });
          if (!cancelled) setEditHistory(history);
        } catch {
          // History load failed — non-critical
        }
      } catch (err) {
        console.error('Failed to join collaborative session:', err);
      }
    };

    joinAndConnect();

    return () => {
      cancelled = true;

      // Leave session
      if (sessionIdRef.current) {
        trpcClient.collaboration.leaveSession
          .mutate({ sessionId: sessionIdRef.current })
          .catch(() => {});
      }

      // Close SSE
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      // Clear heartbeat
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      // Clear debounce timers
      debounceTimers.current.forEach((timer) => clearTimeout(timer));
      debounceTimers.current.clear();

      setIsConnected(false);
      setSessionId(null);
      sessionIdRef.current = null;
    };
  }, [entityId, enabled, displayName]);

  // Debounced field update
  const updateField = useCallback(
    (fieldPath: string, value: string | number | boolean | null) => {
      // Clear existing debounce for this field
      const existing = debounceTimers.current.get(fieldPath);
      if (existing) clearTimeout(existing);

      // Optimistic local update
      setEntity((prev) => {
        if (!prev) return prev;
        const topLevelFields = ['name', 'description', 'imageUrl', 'parentId'];
        if (topLevelFields.includes(fieldPath)) {
          return { ...prev, [fieldPath]: value };
        }
        return {
          ...prev,
          metadata: { ...prev.metadata, [fieldPath]: value },
        };
      });

      // Debounce the server call (300ms)
      const timer = setTimeout(async () => {
        if (!sessionIdRef.current) return;
        try {
          await trpcClient.collaboration.updateField.mutate({
            entityId,
            sessionId: sessionIdRef.current,
            fieldPath,
            value,
          });
          // Invalidate entity queries to keep non-collaborative views in sync
          queryClient.invalidateQueries({ queryKey: ['entity', entityId] });
        } catch (err) {
          console.error('Field update failed:', err);
        }
      }, 300);

      debounceTimers.current.set(fieldPath, timer);
    },
    [entityId, queryClient]
  );

  // Lock a field
  const lockField = useCallback(
    async (fieldPath: string): Promise<boolean> => {
      if (!sessionIdRef.current) return false;
      try {
        const result = await trpcClient.collaboration.lockField.mutate({
          entityId,
          sessionId: sessionIdRef.current,
          fieldPath,
        });
        return result.ok;
      } catch {
        return false;
      }
    },
    [entityId]
  );

  // Unlock a field
  const unlockField = useCallback(
    async (fieldPath: string) => {
      try {
        await trpcClient.collaboration.unlockField.mutate({
          entityId,
          fieldPath,
        });
      } catch {
        // Unlock failed — lock will expire via TTL
      }
    },
    [entityId]
  );

  return {
    entity,
    editors,
    lockedFields,
    isConnected,
    sessionId,
    updateField,
    lockField,
    unlockField,
    editHistory,
  };
}

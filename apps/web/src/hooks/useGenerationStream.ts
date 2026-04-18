/**
 * useGenerationStream — SSE-based real-time generation progress.
 *
 * When the server returns `status: 'queued'` with a `streamUrl`,
 * this hook subscribes to the SSE stream and provides real-time
 * progress updates, completion, and error handling.
 *
 * Usage:
 *   const { subscribe, progress, status, result, error } = useGenerationStream();
 *
 *   // After calling generation.generate and getting a queued response:
 *   subscribe(response.generationId);
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export type GenerationStreamStatus =
  | 'idle'
  | 'connecting'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout';

export interface GenerationStreamResult {
  generationId: string;
  status: 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
  latencyMs?: number;
}

export function useGenerationStream() {
  const [status, setStatus] = useState<GenerationStreamStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<GenerationStreamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const subscribe = useCallback(
    (generationId: string) => {
      cleanup();
      setStatus('connecting');
      setProgress(0);
      setResult(null);
      setError(null);

      const serverUrl = import.meta.env.VITE_SERVER_URL || '';
      const url = `${serverUrl}/api/jobs/${generationId}/stream`;

      const es = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = es;

      es.addEventListener('progress', (event) => {
        try {
          const data = JSON.parse(event.data);
          const percent = data.percent || 0;
          setProgress(percent);
          setStatus(percent > 0 ? 'running' : 'queued');
        } catch {
          // Ignore parse errors
        }
      });

      es.addEventListener('completed', (event) => {
        try {
          const data = JSON.parse(event.data);
          setResult(data);
          setStatus('completed');
          setProgress(100);
        } catch {
          setStatus('completed');
        }
        cleanup();
      });

      es.addEventListener('failed', (event) => {
        try {
          const data = JSON.parse(event.data);
          setError(data.error || 'Generation failed');
          setResult({ generationId, status: 'failed', error: data.error });
        } catch {
          setError('Generation failed');
        }
        setStatus('failed');
        cleanup();
      });

      es.addEventListener('timeout', () => {
        setError('Generation timed out');
        setStatus('timeout');
        cleanup();
      });

      es.addEventListener('heartbeat', () => {
        // Connection alive — no action needed
      });

      es.onerror = () => {
        // EventSource auto-reconnects, but if it fails repeatedly
        // the browser will close it. Only set error if we haven't completed.
        if (status !== 'completed' && status !== 'failed') {
          // Don't set error on first reconnect attempt
          setTimeout(() => {
            if (eventSourceRef.current?.readyState === EventSource.CLOSED) {
              setError('Connection lost. Check generation history for results.');
              setStatus('failed');
              cleanup();
            }
          }, 5000);
        }
      };
    },
    [cleanup, status]
  );

  const reset = useCallback(() => {
    cleanup();
    setStatus('idle');
    setProgress(0);
    setResult(null);
    setError(null);
  }, [cleanup]);

  return {
    subscribe,
    reset,
    status,
    progress,
    result,
    error,
    isActive: status === 'connecting' || status === 'queued' || status === 'running',
  };
}

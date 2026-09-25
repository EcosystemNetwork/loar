import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface AutosaveOptions {
  /** Something unsaved exists. */
  dirty: boolean;
  /** Changes whenever the unsaved content does — restarts the debounce. */
  signature: string;
  /** Off while the episode is still loading or read-only. */
  enabled: boolean;
  /** Persist the current state; must throw on failure. Read through a ref, so it may close over fresh state. */
  save: () => Promise<void>;
  delayMs?: number;
}

/**
 * Debounced background save. Waits `delayMs` after the last edit, saves once at
 * a time, and — after a failure — does NOT retry the same content in a loop
 * (the next edit, or an explicit `saveNow`, tries again).
 *
 * `saveNow` is the manual path (Save button / ⌘S): it queues behind a save
 * already in flight so the latest state is always the last one written.
 */
export function useAutosave({ dirty, signature, enabled, save, delayMs = 2500 }: AutosaveOptions) {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const inflight = useRef<Promise<void> | null>(null);
  const failedSignature = useRef<string | null>(null);
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  const saveRef = useRef(save);
  saveRef.current = save;

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current.catch(() => {});
    const attempt = (async () => {
      setStatus('saving');
      await saveRef.current();
    })();
    inflight.current = attempt;
    const sigAtStart = signatureRef.current;
    try {
      await attempt;
      failedSignature.current = null;
      setStatus('saved');
      setLastSavedAt(Date.now());
      return true;
    } catch {
      failedSignature.current = sigAtStart;
      setStatus('error');
      return false;
    } finally {
      if (inflight.current === attempt) inflight.current = null;
      // Edits made while saving are still dirty — let the effect pick them up.
      setTick((t) => t + 1);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !dirty || inflight.current) return;
    if (failedSignature.current === signature) return;
    const timer = setTimeout(() => void saveNow(), delayMs);
    return () => clearTimeout(timer);
  }, [enabled, dirty, signature, delayMs, tick, saveNow]);

  return { status, lastSavedAt, saveNow };
}

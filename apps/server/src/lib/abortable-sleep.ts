/**
 * Sleep for `ms`, but resolve early (and throw) when `signal` aborts.
 *
 * Pairs with async poll loops that should react to caller cancellation
 * (tRPC `ctx.signal`, dispatcher `signal: AbortSignal` plumbing) instead
 * of holding a worker thread for the full sleep window.
 *
 *   for (let i = 0; i < maxAttempts; i++) {
 *     await abortableSleep(intervalMs, signal);
 *     ...
 *   }
 *
 * Throws the signal's `reason` on abort. Callers should let it propagate
 * so the surrounding tRPC handler returns a clean cancellation rather
 * than continuing to burn cost on a request the user has gone away from.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error('aborted'));
  }
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

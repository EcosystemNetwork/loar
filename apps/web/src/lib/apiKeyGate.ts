/**
 * apiKeyGate — imperative trigger for the global "add your API key" modal.
 *
 * Mirrors the `sonner` toast pattern: any code (a mutation's onError, a
 * ModelSelector click handler, a mutation-cache global handler) calls
 * `requireProviderKey(provider)` from anywhere, and the singleton
 * `<ApiKeyGateModal />` mounted once in `__root.tsx` picks it up and shows
 * the popup. No React context/provider wiring needed at every call site.
 *
 * `requireProviderKey` resolves `true` once the user saves a working key
 * for that provider, or `false` if they dismiss the modal — callers can
 * `await` it to retry whatever they were doing.
 */

export interface ApiKeyGateRequest {
  provider: string;
  /** Optional one-line reason shown above the form ("This model needs…"). */
  reason?: string;
  resolve: (saved: boolean) => void;
}

type Listener = (request: ApiKeyGateRequest) => void;

let listener: Listener | null = null;

/** Registered once by `<ApiKeyGateModal />`. Returns an unsubscribe fn. */
export function registerApiKeyGateListener(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/**
 * Ask the user to add a BYOK key for `provider`. Opens the global modal and
 * resolves once they save a key (true) or dismiss (false). If no modal is
 * mounted (shouldn't happen — it's in the root layout), resolves false
 * immediately rather than hanging the caller.
 */
export function requireProviderKey(provider: string, opts?: { reason?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(false);
      return;
    }
    listener({ provider, reason: opts?.reason, resolve });
  });
}

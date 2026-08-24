/**
 * Model usability — answers "can *this* user actually dispatch to this
 * model right now?" for a model catalog entry.
 *
 * A model is usable when either:
 *   - the caller has their own (enabled) BYOK key for the model's provider, or
 *   - the platform's server-pool key for that provider is configured
 *     (`serverPoolEnvVar` set) AND the model opts into the server pool
 *     (per-model `serverPoolAvailable` flag, defaults to true for configs
 *     that don't carry the field).
 *
 * Centralized here so every model catalog endpoint (image, video, tts,
 * audio, editing, transcription, …) reports the same `usableByMe` /
 * `unusableReason` shape the frontend renders as a "Coming Soon" state —
 * BYOK always unlocks a model regardless of platform credit.
 */
import { isKnownProvider } from './registry';
import { listForUser } from './store';
import { serverPoolAvailable } from './dispatcher';
import { PROVIDER_REGISTRY } from './registry';

export interface ModelUsability {
  /** True when the current caller can dispatch to this model right now. */
  usableByMe: boolean;
  /** Why it's unusable — surface to the UI for the disabled/"Coming Soon" tooltip. */
  unusableReason: string | null;
  sourceOnDispatch: 'byok' | 'server' | null;
}

/** Fetch the set of providers the user has an enabled BYOK key for. Empty for anonymous callers. */
export async function getByokProviderSet(userId: string | null | undefined): Promise<Set<string>> {
  if (!userId) return new Set();
  const keys = await listForUser(userId);
  return new Set(keys.filter((k) => k.enabled).map((k) => k.provider));
}

/**
 * Synchronous per-model usability check — call `getByokProviderSet` once per
 * request and reuse it across every model in the catalog being listed.
 */
export function computeModelUsability(
  provider: string,
  byokProviders: Set<string>,
  modelServerPoolAvailable = true
): ModelUsability {
  if (!isKnownProvider(provider)) {
    return { usableByMe: false, unusableReason: 'Unknown provider', sourceOnDispatch: null };
  }
  const hasByok = byokProviders.has(provider);
  const hasServer = modelServerPoolAvailable && serverPoolAvailable(provider);
  const usableByMe = hasByok || hasServer;
  return {
    usableByMe,
    unusableReason: usableByMe
      ? null
      : `Add a ${PROVIDER_REGISTRY[provider].displayName} API key in Settings to enable this model.`,
    sourceOnDispatch: hasByok ? 'byok' : hasServer ? 'server' : null,
  };
}

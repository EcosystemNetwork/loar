/**
 * Model usability — answers "can *this* user actually dispatch to this
 * model right now?" for a model catalog entry.
 *
 * BYOK-only: a model is usable only when the caller has their own (enabled)
 * key for the model's provider on file. The platform server-pool key is no
 * longer a usability path — `resolveProviderKey` (dispatcher.ts) never
 * falls back to it either, so this flag matches what dispatch will actually
 * allow.
 *
 * Centralized here so every model catalog endpoint (image, video, tts,
 * audio, editing, transcription, …) reports the same `usableByMe` /
 * `unusableReason` shape the frontend renders as a locked state with a
 * "connect your key" prompt.
 */
import { isKnownProvider } from './registry';
import { listForUser } from './store';
import { PROVIDER_REGISTRY } from './registry';

/**
 * Providers that dispatch to a self-hosted/free backend with no API-key
 * concept at all — they're deliberately absent from the BYOK
 * `PROVIDER_REGISTRY` (there's nothing to bring your own key *for*), so
 * `isKnownProvider` correctly says false. Without this, every model on such
 * a provider (e.g. ComfyUI, self-hosted/local) got mislabeled "Unknown
 * provider" / disabled by the generic closed-registry check below instead
 * of the always-available free option it actually is (#audit finding 3).
 */
const NO_KEY_REQUIRED_PROVIDERS = new Set(['comfyui']);

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
  /**
   * Kept for call-site compatibility (every catalog endpoint still passes
   * the model's `serverPoolAvailable` flag) but no longer consulted — the
   * server pool never grants usability now that dispatch is BYOK-only.
   */
  _modelServerPoolAvailable = true
): ModelUsability {
  if (NO_KEY_REQUIRED_PROVIDERS.has(provider)) {
    return { usableByMe: true, unusableReason: null, sourceOnDispatch: 'server' };
  }
  if (!isKnownProvider(provider)) {
    return { usableByMe: false, unusableReason: 'Unknown provider', sourceOnDispatch: null };
  }
  const hasByok = byokProviders.has(provider);
  return {
    usableByMe: hasByok,
    unusableReason: hasByok
      ? null
      : `Add a ${PROVIDER_REGISTRY[provider].displayName} API key in Settings to enable this model.`,
    sourceOnDispatch: hasByok ? 'byok' : null,
  };
}

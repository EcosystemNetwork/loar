/**
 * Shared types for the BYOK provider-keys system.
 *
 * A `ProviderKey` is a user-supplied API key for one of the providers
 * we route through. The plaintext value never leaves the server after
 * creation. We persist `encryptedKey` (AES-256-GCM) and a `fingerprint`
 * (sha256-truncated) used purely for UI display ("ends in a3f4").
 */

/**
 * The closed set of providers the BYOK system supports. Add a new
 * provider here, then list it in `PROVIDER_REGISTRY` in `registry.ts`
 * with its test endpoint and SDK env var.
 */
export type ProviderId =
  | 'fal'
  | 'assemblyai'
  | 'deepgram'
  | 'groq'
  | 'elevenlabs'
  | 'bytedance'
  | 'zai'
  | 'openai'
  | 'google'
  | 'meshy'
  | 'tripo'
  | 'minimax';

export interface ProviderKeyDoc {
  /** Doc id is `${userId}_${provider}`. */
  userId: string;
  provider: ProviderId;
  /** `sha256(plaintext).slice(0, 16)`. Safe to expose to the UI. */
  fingerprint: string;
  /**
   * Trailing 4 chars of the plaintext key for UI display ("•••• a3f4").
   * Not an entropy leak — the user can already see this in their own
   * provider dashboard.
   */
  last4: string;
  /** base64(nonce || ciphertext || authTag). Decryption owns the master key. */
  encryptedKey: string;
  enabled: boolean;
  /** Last time we probed the provider with this key. Null until first test. */
  testedAt: Date | null;
  /**
   * Outcome of the last probe. `invalid` means the provider rejected the stored
   * key (revoked/rotated at the provider) — the UI prompts the user to replace it.
   */
  lastCheckStatus?: 'valid' | 'invalid' | null;
  /** Last time the dispatcher decrypted + used this key. */
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Public-safe projection of a key — never carries plaintext or ciphertext. */
export interface ProviderKeyPublic {
  provider: ProviderId;
  fingerprint: string;
  last4: string;
  enabled: boolean;
  testedAt: Date | null;
  lastCheckStatus: 'valid' | 'invalid' | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface ProviderRegistryEntry {
  id: ProviderId;
  displayName: string;
  /** Human-readable docs URL where a user can generate a key. */
  apiKeyDocsUrl: string;
  /** Env var name holding the server's pool key for this provider. */
  serverPoolEnvVar: string;
  /**
   * Lightweight test call to verify a key is valid. Should call a
   * cheap/free endpoint on the provider. Resolves `true` if auth passed,
   * `false` if the provider rejected the key, and throws
   * `KeyVerificationUnavailableError` if no verdict could be reached.
   */
  testKey: (plaintextKey: string) => Promise<boolean>;
}

export class ProviderKeyNotFoundError extends Error {
  constructor(
    public userId: string,
    public provider: ProviderId
  ) {
    super(`No BYOK key on file for user ${userId} / provider ${provider}`);
    this.name = 'ProviderKeyNotFoundError';
  }
}

export class UnknownProviderError extends Error {
  constructor(public provider: string) {
    super(`Unknown provider: ${provider}`);
    this.name = 'UnknownProviderError';
  }
}

export class ProviderKeyDecryptError extends Error {
  constructor(message: string) {
    super(`Decrypt failed: ${message}`);
    this.name = 'ProviderKeyDecryptError';
  }
}

/**
 * Thrown by a provider's `testKey` when it could not reach a verdict (network
 * error, timeout, provider 5xx). Distinct from a `false` result, which means
 * the provider explicitly rejected the key.
 */
export class KeyVerificationUnavailableError extends Error {
  constructor(public provider: string) {
    super(`Could not reach ${provider} to verify the key right now — try again in a moment.`);
    this.name = 'KeyVerificationUnavailableError';
  }
}

/**
 * A caller tried to use a provider they have no (enabled) BYOK key for. This is
 * expected control flow, not a bug: `lib/trpc.ts`'s errorFormatter turns it
 * (direct or as any `error.cause`) into `data.byokRequired` + `data.provider`,
 * which the web client shows as the "add your key" modal. Every "no key" guard
 * — service `configureCall`s, route pre-checks, the dispatcher — should throw
 * this rather than a bare `Error`, or the modal never opens.
 */
export class NoKeyAvailableError extends Error {
  constructor(
    public provider: ProviderId,
    message?: string
  ) {
    super(
      message ??
        `No ${provider} API key on file — add one at /settings/api-keys to use this feature.`
    );
    this.name = 'NoKeyAvailableError';
  }
}

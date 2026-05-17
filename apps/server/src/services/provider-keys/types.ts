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
export type ProviderId = 'fal' | 'assemblyai' | 'deepgram' | 'groq' | 'elevenlabs';

export interface ProviderKeyDoc {
  /** Doc id is `${userId}_${provider}`. */
  userId: string;
  provider: ProviderId;
  /** `sha256(plaintext).slice(0, 16)`. Safe to expose to the UI. */
  fingerprint: string;
  /** base64(nonce || ciphertext || authTag). Decryption owns the master key. */
  encryptedKey: string;
  enabled: boolean;
  /** Last successful test-call ping. Null until first test. */
  testedAt: Date | null;
  /** Last time the dispatcher decrypted + used this key. */
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Public-safe projection of a key — never carries plaintext or ciphertext. */
export interface ProviderKeyPublic {
  provider: ProviderId;
  fingerprint: string;
  enabled: boolean;
  testedAt: Date | null;
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
   * cheap/free endpoint on the provider. Returns true on success,
   * throws on auth failure or network error.
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

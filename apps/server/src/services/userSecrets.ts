/**
 * User-supplied secret storage (BYOK).
 *
 * Encrypts external API keys (e.g. ByteDance ModelArk) at rest in Firestore
 * with AES-256-GCM keyed by the server-held USER_SECRETS_MASTER_KEY env var.
 * Plaintext only ever exists in process memory at the moment of an outbound
 * HTTP call — never sent to the client, never logged, never returned by tRPC.
 *
 * Storage shape (`userSecrets/{uid}` doc):
 *   {
 *     "bytedance": { ciphertext: "<base64>", iv: "<base64>", authTag: "<base64>",
 *                    updatedAt: 12345, last4: "abcd" },
 *     "<other-provider>": { ... }
 *   }
 *
 * `last4` is the trailing 4 chars of the original key (no entropy leak — it's
 * what the user themselves can already see in their ModelArk dashboard) so the
 * UI can render "•••• abcd" status without needing to decrypt.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { db } from '../lib/firebase';

export type SecretProvider = 'bytedance';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

interface EncryptedField {
  ciphertext: string;
  iv: string;
  authTag: string;
  updatedAt: number;
  last4: string;
}

let cachedKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.USER_SECRETS_MASTER_KEY?.trim() || '';
  if (!raw) {
    throw new Error(
      'USER_SECRETS_MASTER_KEY is required to encrypt user-supplied API keys. ' +
        'Generate with: openssl rand -hex 32'
    );
  }
  // Accept hex (64 chars) or base64 (44 chars) representations
  let key: Buffer;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `USER_SECRETS_MASTER_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length})`
    );
  }
  cachedKey = key;
  return key;
}

function encrypt(plaintext: string): EncryptedField {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    updatedAt: Date.now(),
    last4: plaintext.slice(-4),
  };
}

function decrypt(field: EncryptedField): string {
  const key = getMasterKey();
  const iv = Buffer.from(field.iv, 'base64');
  const authTag = Buffer.from(field.authTag, 'base64');
  const ciphertext = Buffer.from(field.ciphertext, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString('utf8');
}

const userSecretsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userSecrets');
};

/**
 * Store (or replace) a user's API key for the given provider.
 * Plaintext is never persisted — only AES-GCM ciphertext + IV + auth tag.
 */
export async function setUserSecret(
  uid: string,
  provider: SecretProvider,
  value: string
): Promise<void> {
  if (!uid) throw new Error('uid is required');
  if (!value || value.trim().length < 8) {
    throw new Error('Secret value is too short to be a real API key');
  }
  const trimmed = value.trim();
  const field = encrypt(trimmed);
  await userSecretsCol()
    .doc(uid)
    .set({ [provider]: field }, { merge: true });
}

/**
 * Decrypt and return a user's stored secret. Server-side only — never expose
 * the return value to clients. Returns null if no secret is set.
 */
export async function getUserSecret(uid: string, provider: SecretProvider): Promise<string | null> {
  if (!uid) return null;
  try {
    const doc = await userSecretsCol().doc(uid).get();
    if (!doc.exists) return null;
    const field = doc.data()?.[provider] as EncryptedField | undefined;
    if (!field?.ciphertext) return null;
    return decrypt(field);
  } catch (err) {
    console.error('[userSecrets] decrypt failed', err);
    return null;
  }
}

/**
 * Remove a user's stored secret for the given provider.
 */
export async function clearUserSecret(uid: string, provider: SecretProvider): Promise<void> {
  if (!uid) throw new Error('uid is required');
  // Use FieldValue.delete() so the field is removed entirely rather than nulled
  const FieldValue = (await import('firebase-admin/firestore')).FieldValue;
  await userSecretsCol()
    .doc(uid)
    .set({ [provider]: FieldValue.delete() }, { merge: true });
}

/**
 * Returns a summary of which providers the user has set, with last4 for UI
 * rendering. Never includes plaintext.
 */
export async function listUserSecretSummary(
  uid: string
): Promise<Record<SecretProvider, { last4: string; updatedAt: number } | null>> {
  const summary: Record<SecretProvider, { last4: string; updatedAt: number } | null> = {
    bytedance: null,
  };
  if (!uid) return summary;
  const doc = await userSecretsCol().doc(uid).get();
  if (!doc.exists) return summary;
  const data = doc.data() ?? {};
  for (const provider of Object.keys(summary) as SecretProvider[]) {
    const field = data[provider] as EncryptedField | undefined;
    if (field?.ciphertext) {
      summary[provider] = {
        last4: field.last4 ?? '',
        updatedAt: field.updatedAt ?? 0,
      };
    }
  }
  return summary;
}

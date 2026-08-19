/**
 * AES-256-GCM seal/unseal for BYOK provider keys.
 *
 * New records use a KMS-generated data-encryption key when
 * `PROVIDER_KEY_KMS_KEY_ID` is configured. Legacy records remain readable
 * with `PROVIDER_KEY_MASTER_KEY` so deployments can migrate without forcing
 * users to enter their provider keys again.
 *
 * Sealed payload byte layout:
 *   [0..12)  : nonce (12 bytes)
 *   [12..N)  : ciphertext (N-12-16 bytes)
 *   [N-16..N): authTag (16 bytes)
 *
 * The base64 string we persist is the concatenation of the three.
 */
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { ProviderKeyDecryptError } from './types';

const ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KMS_PREFIX = 'kms:v1:';
let kmsClient: KMSClient | null = null;

function getKmsClient(): KMSClient {
  if (!kmsClient) kmsClient = new KMSClient({ region: process.env.KMS_REGION || 'us-east-1' });
  return kmsClient;
}

function masterKey(): Buffer {
  const hex = process.env.PROVIDER_KEY_MASTER_KEY;
  if (!hex) {
    throw new Error('PROVIDER_KEY_MASTER_KEY is required. Generate with `openssl rand -hex 32`.');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex.trim())) {
    throw new Error('PROVIDER_KEY_MASTER_KEY must be 32 bytes hex-encoded (64 hex chars).');
  }
  return Buffer.from(hex.trim(), 'hex');
}

function encrypt(plaintext: string, key: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
}

function decrypt(sealed: string, key: Buffer): string {
  const buf = Buffer.from(sealed, 'base64');
  if (buf.length < NONCE_BYTES + TAG_BYTES + 1) {
    throw new ProviderKeyDecryptError('ciphertext too short');
  }
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ciphertext = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export async function seal(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error('seal() called with empty plaintext');
  const keyId = process.env.PROVIDER_KEY_KMS_KEY_ID;
  if (!keyId) return encrypt(plaintext, masterKey());
  const result = await getKmsClient().send(
    new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256' })
  );
  if (!result.Plaintext || !result.CiphertextBlob) {
    throw new Error('KMS GenerateDataKey returned an incomplete response');
  }
  const encryptedKey = Buffer.from(result.CiphertextBlob).toString('base64');
  return `${KMS_PREFIX}${encryptedKey}:${encrypt(plaintext, Buffer.from(result.Plaintext))}`;
}

export async function unseal(sealed: string): Promise<string> {
  try {
    if (!sealed.startsWith(KMS_PREFIX)) return decrypt(sealed, masterKey());
    const [encryptedKey, payload] = sealed.slice(KMS_PREFIX.length).split(':', 2);
    if (!encryptedKey || !payload) throw new Error('invalid KMS envelope');
    const result = await getKmsClient().send(
      new DecryptCommand({ CiphertextBlob: Buffer.from(encryptedKey, 'base64') })
    );
    if (!result.Plaintext) throw new Error('KMS Decrypt returned no plaintext');
    return decrypt(payload, Buffer.from(result.Plaintext));
  } catch (err) {
    throw new ProviderKeyDecryptError(err instanceof Error ? err.message : 'unknown decrypt error');
  }
}

/**
 * Short, deterministic identifier for a key. Safe to expose to the UI
 * because it cannot be reversed to recover the key. Used to render
 * "key ending in ...a3f4" in the settings page.
 */
export function fingerprint(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex').slice(0, 16);
}

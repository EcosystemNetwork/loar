/**
 * AES-256-GCM seal/unseal for BYOK provider keys.
 *
 * Master key comes from `PROVIDER_KEY_MASTER_KEY` env var — 32 raw bytes,
 * hex-encoded. Generate one with:
 *
 *   openssl rand -hex 32
 *
 * KMS-wrapped DEK is future work (see PRD "Open follow-ups"). The format
 * intentionally pins nonce + ciphertext + authTag in one base64 blob so a
 * future migration can read the existing rows and re-encrypt without a
 * schema change.
 *
 * Sealed payload byte layout:
 *   [0..12)  : nonce (12 bytes)
 *   [12..N)  : ciphertext (N-12-16 bytes)
 *   [N-16..N): authTag (16 bytes)
 *
 * The base64 string we persist is the concatenation of the three.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { ProviderKeyDecryptError } from './types';

const ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

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

export function seal(plaintext: string): string {
  if (!plaintext) throw new Error('seal() called with empty plaintext');
  const key = masterKey();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64');
}

export function unseal(sealed: string): string {
  let buf: Buffer;
  try {
    buf = Buffer.from(sealed, 'base64');
  } catch {
    throw new ProviderKeyDecryptError('invalid base64');
  }
  if (buf.length < NONCE_BYTES + TAG_BYTES + 1) {
    throw new ProviderKeyDecryptError('ciphertext too short');
  }
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ciphertext = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGO, masterKey(), nonce);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return out.toString('utf8');
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

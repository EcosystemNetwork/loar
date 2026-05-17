/**
 * One-time migration: copy legacy `userSecrets/{uid}.{provider}` rows
 * into the new `userProviderKeys/{uid}_{provider}` collection.
 *
 * Standalone — does NOT import from `services/userSecrets` (which has
 * been deleted as part of Phase D). The decrypt path is inlined below.
 *
 * Strategy:
 *   1. Read every doc in `userSecrets/*`.
 *   2. For each provider field present, decrypt with USER_SECRETS_MASTER_KEY
 *      (legacy IV/authTag base64 format), re-encrypt with
 *      PROVIDER_KEY_MASTER_KEY (new nonce|ciphertext|authTag base64 blob),
 *      write to `userProviderKeys/{uid}_{provider}` with `enabled: true`,
 *      `testedAt: null`, `lastUsedAt: null`.
 *   3. Idempotent: skip if the target doc already exists.
 *
 * Usage:
 *   DRY_RUN=1 pnpm -F server tsx scripts/migrate-user-secrets.ts        (default)
 *   DRY_RUN=0 pnpm -F server tsx scripts/migrate-user-secrets.ts        (writes)
 *
 * Requires BOTH env vars to be set:
 *   USER_SECRETS_MASTER_KEY     legacy decrypt
 *   PROVIDER_KEY_MASTER_KEY     new-system encrypt
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDecipheriv } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DRY_RUN = process.env.DRY_RUN !== '0';
const LEGACY_ALGO = 'aes-256-gcm';
const LEGACY_KEY_LENGTH = 32;

function readLegacyMasterKey(): Buffer {
  const raw = process.env.USER_SECRETS_MASTER_KEY?.trim() || '';
  if (!raw) throw new Error('USER_SECRETS_MASTER_KEY is required (legacy decrypt)');
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
    return Buffer.from(raw, 'hex');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== LEGACY_KEY_LENGTH) {
    throw new Error(`USER_SECRETS_MASTER_KEY must decode to ${LEGACY_KEY_LENGTH} bytes`);
  }
  return buf;
}

interface LegacyField {
  ciphertext: string;
  iv: string;
  authTag: string;
  updatedAt?: number;
  last4?: string;
}

function legacyDecrypt(field: LegacyField, key: Buffer): string {
  const iv = Buffer.from(field.iv, 'base64');
  const authTag = Buffer.from(field.authTag, 'base64');
  const ciphertext = Buffer.from(field.ciphertext, 'base64');
  const decipher = createDecipheriv(LEGACY_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString('utf8');
}

(async () => {
  const { db, firebaseAvailable } = await import('../src/lib/firebase');
  if (!firebaseAvailable || !db) {
    console.error('Firebase is not configured — set the FIREBASE_* env vars.');
    process.exit(1);
  }

  const { seal, fingerprint } = await import('../src/services/provider-keys/crypto');
  const { isKnownProvider } = await import('../src/services/provider-keys/registry');

  if (!process.env.PROVIDER_KEY_MASTER_KEY) {
    console.error('PROVIDER_KEY_MASTER_KEY is required (new-system encrypt).');
    process.exit(1);
  }
  const legacyKey = readLegacyMasterKey();

  console.log(`[migrate] ${DRY_RUN ? 'DRY RUN' : 'LIVE'} — copying userSecrets → userProviderKeys`);

  const stats = {
    docsScanned: 0,
    providersFound: 0,
    eligible: 0,
    skippedExisting: 0,
    skippedUnknownProvider: 0,
    written: 0,
    decryptFailed: 0,
  };

  const snap = await db.collection('userSecrets').get();
  stats.docsScanned = snap.size;

  for (const doc of snap.docs) {
    const uid = doc.id;
    const data = doc.data() ?? {};
    for (const provider of Object.keys(data)) {
      const field = data[provider];
      if (!field || typeof field !== 'object' || !('ciphertext' in field)) continue;
      stats.providersFound++;

      if (!isKnownProvider(provider)) {
        stats.skippedUnknownProvider++;
        continue;
      }
      stats.eligible++;

      const targetId = `${uid}_${provider}`;
      const targetRef = db.collection('userProviderKeys').doc(targetId);
      const existing = await targetRef.get();
      if (existing.exists) {
        stats.skippedExisting++;
        continue;
      }

      let plaintext: string;
      try {
        plaintext = legacyDecrypt(field as LegacyField, legacyKey);
      } catch (err) {
        stats.decryptFailed++;
        console.warn(
          `[migrate] decrypt failed for ${uid}/${provider} — skipped`,
          err instanceof Error ? err.message : err
        );
        continue;
      }

      const fp = fingerprint(plaintext);
      const encryptedKey = seal(plaintext);
      const now = new Date();
      const writePayload = {
        userId: uid,
        provider,
        fingerprint: fp,
        last4: plaintext.slice(-4),
        encryptedKey,
        enabled: true,
        testedAt: null,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
        migratedFrom: 'userSecrets',
      };

      if (DRY_RUN) {
        console.log(`[migrate] would write userProviderKeys/${targetId} (fp=${fp})`);
      } else {
        await targetRef.set(writePayload);
        console.log(`[migrate] wrote   userProviderKeys/${targetId} (fp=${fp})`);
      }
      stats.written++;
    }
  }

  console.log('[migrate] done', stats);
  process.exit(0);
})().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});

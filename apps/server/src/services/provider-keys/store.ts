/**
 * Encrypted CRUD on `userProviderKeys`.
 *
 * Plaintext keys enter only via `upsert()` and leave only via
 * `loadPlaintext()` (called by the dispatcher just-in-time before
 * a provider SDK call). All other reads return `ProviderKeyPublic`,
 * which carries the fingerprint but no key material.
 *
 * Doc id convention: `${userId}_${provider}` — guarantees one key per
 * (user, provider) pair without a separate uniqueness check.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../lib/firebase';
import { seal, unseal, fingerprint } from './crypto';
import {
  ProviderKeyNotFoundError,
  UnknownProviderError,
  type ProviderId,
  type ProviderKeyDoc,
  type ProviderKeyPublic,
} from './types';
import { isKnownProvider, PROVIDER_REGISTRY } from './registry';

function col() {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userProviderKeys');
}

function docId(userId: string, provider: ProviderId): string {
  return `${userId}_${provider}`;
}

function toPublic(doc: ProviderKeyDoc): ProviderKeyPublic {
  return {
    provider: doc.provider,
    fingerprint: doc.fingerprint,
    last4: doc.last4 ?? '',
    enabled: doc.enabled,
    testedAt: doc.testedAt,
    lastUsedAt: doc.lastUsedAt,
    createdAt: doc.createdAt,
  };
}

export async function listForUser(userId: string): Promise<ProviderKeyPublic[]> {
  const snap = await col().where('userId', '==', userId).get();
  return snap.docs.map((d) => toPublic(d.data() as ProviderKeyDoc));
}

export async function exists(userId: string, provider: ProviderId): Promise<boolean> {
  const snap = await col().doc(docId(userId, provider)).get();
  return snap.exists;
}

/**
 * Persist a new key (or replace an existing one). Runs the provider's
 * test endpoint before saving — bad keys are rejected, never stored.
 */
export async function upsert(
  userId: string,
  provider: string,
  plaintextKey: string
): Promise<ProviderKeyPublic> {
  if (!isKnownProvider(provider)) throw new UnknownProviderError(provider);
  if (!plaintextKey || plaintextKey.length < 10) {
    throw new Error('API key looks too short to be valid.');
  }

  const entry = PROVIDER_REGISTRY[provider];
  const passed = await entry.testKey(plaintextKey);
  if (!passed) {
    throw new Error(
      `${entry.displayName} rejected the API key. Verify it at ${entry.apiKeyDocsUrl}.`
    );
  }

  const fp = fingerprint(plaintextKey);
  const encryptedKey = seal(plaintextKey);
  const last4 = plaintextKey.slice(-4);
  const now = new Date();
  const ref = col().doc(docId(userId, provider));
  const prior = await ref.get();
  const doc: ProviderKeyDoc = {
    userId,
    provider,
    fingerprint: fp,
    last4,
    encryptedKey,
    enabled: prior.exists ? ((prior.data()?.enabled as boolean) ?? true) : true,
    testedAt: now,
    lastUsedAt: prior.exists ? ((prior.data()?.lastUsedAt as Date | null) ?? null) : null,
    createdAt: prior.exists ? ((prior.data()?.createdAt as Date) ?? now) : now,
    updatedAt: now,
  };
  await ref.set(doc, { merge: true });
  return toPublic(doc);
}

export async function setEnabled(
  userId: string,
  provider: ProviderId,
  enabled: boolean
): Promise<void> {
  const ref = col().doc(docId(userId, provider));
  const snap = await ref.get();
  if (!snap.exists) throw new ProviderKeyNotFoundError(userId, provider);
  await ref.update({ enabled, updatedAt: new Date() });
}

export async function remove(userId: string, provider: ProviderId): Promise<void> {
  const ref = col().doc(docId(userId, provider));
  const snap = await ref.get();
  if (!snap.exists) throw new ProviderKeyNotFoundError(userId, provider);
  await ref.delete();
}

/**
 * Decrypt and return the plaintext key. Only the dispatcher should call
 * this — caller is responsible for not logging or persisting the value.
 * Bumps `lastUsedAt` as a side effect.
 */
export async function loadPlaintext(userId: string, provider: ProviderId): Promise<string> {
  const ref = col().doc(docId(userId, provider));
  const snap = await ref.get();
  if (!snap.exists) throw new ProviderKeyNotFoundError(userId, provider);
  const data = snap.data() as ProviderKeyDoc;
  if (!data.enabled) {
    throw new ProviderKeyNotFoundError(userId, provider); // treat disabled as absent
  }
  // Fire-and-forget update so we don't slow the hot path.
  void ref
    .update({ lastUsedAt: FieldValue.serverTimestamp() })
    .catch((err) => console.warn('[providerKeys] lastUsedAt update failed:', err));
  return unseal(data.encryptedKey);
}

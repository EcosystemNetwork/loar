/**
 * API Key Authentication
 *
 * Provides API key-based auth for programmatic access by AI agents
 * and external integrations. Keys are stored hashed in Firestore.
 *
 * Key format: loar_<agentId>_<randomHex>
 * Storage: SHA-256 hash of the full key, lookup by prefix (agentId)
 */
import { db, firebaseAvailable } from './firebase';
import { createHash, randomBytes } from 'crypto';
import { TRPCError } from '@trpc/server';
import type { AuthUser } from './auth';

// ── Types ──────────────────────────────────────────────────────────────

export interface ApiKeyDoc {
  id: string;
  keyHash: string; // SHA-256 of full key
  keyPrefix: string; // first 12 chars for identification
  name: string; // human-readable label
  ownerUid: string; // wallet address of key creator
  aiAgentId: string | null; // linked AI agent (if any)
  permissions: string[]; // scoped permissions
  rateLimitPerMinute: number;
  totalRequests: number;
  lastUsedAt: Date | null;
  status: 'active' | 'revoked';
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyUsageDoc {
  apiKeyId: string;
  endpoint: string;
  creditsUsed: number;
  timestamp: Date;
}

// ── Helpers ────────────────────────────────────────────────────────────

const apiKeysCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('apiKeys');
};

const apiKeyUsageCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('apiKeyUsage');
};

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// In-memory rate limit tracking
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

// ── Key Generation ─────────────────────────────────────────────────────

/**
 * Generate a new API key. Returns the raw key (only shown once) and the doc.
 */
export async function generateApiKey(params: {
  name: string;
  ownerUid: string;
  aiAgentId?: string;
  permissions: string[];
  rateLimitPerMinute?: number;
  expiresInDays?: number;
}): Promise<{ rawKey: string; keyDoc: ApiKeyDoc }> {
  const randomPart = randomBytes(24).toString('hex');
  const agentPart = params.aiAgentId || 'global';
  const rawKey = `loar_${agentPart.slice(0, 8)}_${randomPart}`;
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 16);

  const doc: Omit<ApiKeyDoc, 'id'> = {
    keyHash,
    keyPrefix,
    name: params.name,
    ownerUid: params.ownerUid,
    aiAgentId: params.aiAgentId || null,
    permissions: params.permissions,
    rateLimitPerMinute: params.rateLimitPerMinute || 60,
    totalRequests: 0,
    lastUsedAt: null,
    status: 'active',
    expiresAt: params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
      : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const ref = await apiKeysCol().add(doc);
  return { rawKey, keyDoc: { id: ref.id, ...doc } };
}

// ── Key Verification ───────────────────────────────────────────────────

/**
 * Verify an API key from request headers.
 * Returns AuthUser-compatible object if valid, null otherwise.
 * Also returns the key doc for permission checks.
 */
export async function verifyApiKey(
  apiKey: string
): Promise<{ user: AuthUser; keyDoc: ApiKeyDoc } | null> {
  if (!apiKey || !apiKey.startsWith('loar_')) return null;

  const keyHash = hashKey(apiKey);

  // Look up by hash
  const snapshot = await apiKeysCol()
    .where('keyHash', '==', keyHash)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const keyDoc = { id: doc.id, ...doc.data() } as ApiKeyDoc;

  // Check expiration
  if (keyDoc.expiresAt && new Date() > new Date(keyDoc.expiresAt as any)) {
    await apiKeysCol().doc(doc.id).update({ status: 'revoked', updatedAt: new Date() });
    return null;
  }

  // Rate limiting (in-memory, per key)
  const now = Date.now();
  const windowMs = 60_000;
  const existing = rateLimitMap.get(doc.id);

  if (existing && now - existing.windowStart < windowMs) {
    if (existing.count >= keyDoc.rateLimitPerMinute) {
      return null; // Rate limited
    }
    existing.count++;
  } else {
    rateLimitMap.set(doc.id, { count: 1, windowStart: now });
  }

  // Update usage stats (fire-and-forget)
  apiKeysCol()
    .doc(doc.id)
    .update({
      totalRequests: (keyDoc.totalRequests || 0) + 1,
      lastUsedAt: new Date(),
    })
    .catch(() => {});

  // Return auth user as the key owner
  return {
    user: {
      uid: keyDoc.ownerUid,
      address: keyDoc.ownerUid,
    },
    keyDoc,
  };
}

// ── Key Management ─────────────────────────────────────────────────────

export async function revokeApiKey(keyId: string, ownerUid: string): Promise<void> {
  const doc = await apiKeysCol().doc(keyId).get();
  if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' });
  if (doc.data()?.ownerUid !== ownerUid) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the key owner' });
  }

  await apiKeysCol().doc(keyId).update({ status: 'revoked', updatedAt: new Date() });
}

export async function listApiKeys(ownerUid: string): Promise<Omit<ApiKeyDoc, 'keyHash'>[]> {
  const snapshot = await apiKeysCol()
    .where('ownerUid', '==', ownerUid)
    .orderBy('createdAt', 'desc')
    .get();

  return snapshot.docs.map((d) => {
    const data = d.data();
    const { keyHash, ...rest } = data;
    return { id: d.id, ...rest } as Omit<ApiKeyDoc, 'keyHash'>;
  });
}

export async function getApiKeyUsage(
  keyId: string,
  limit: number = 100
): Promise<ApiKeyUsageDoc[]> {
  const snapshot = await apiKeyUsageCol()
    .where('apiKeyId', '==', keyId)
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((d) => ({ ...d.data() }) as ApiKeyUsageDoc);
}

/**
 * Track API key usage. Fire-and-forget.
 */
export async function trackApiKeyUsage(
  keyId: string,
  endpoint: string,
  creditsUsed: number = 0
): Promise<void> {
  try {
    await apiKeyUsageCol().add({
      apiKeyId: keyId,
      endpoint,
      creditsUsed,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('Failed to track API key usage:', err);
  }
}

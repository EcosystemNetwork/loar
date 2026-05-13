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

// ── Permission Scopes ─────────────────────────────────────────────────

/**
 * Defined permission scopes for API keys. Using an enum prevents
 * arbitrary strings and makes auditing possible.
 */
export const API_KEY_SCOPES = {
  // Read-only
  'entities.read': 'Read entities and wiki data',
  'universes.read': 'Read universe metadata',
  'marketplace.read': 'Read marketplace listings',
  'credits.read': 'Read credit balance',
  'profiles.read': 'Read user profiles',

  // Write — creation
  'entities.create': 'Create entities',
  'entities.update': 'Update entities',

  // Write — generation (costs credits)
  'generation.image': 'Generate images (costs credits)',
  'generation.video': 'Generate videos (costs credits)',
  'generation.voice': 'Generate voice/audio (costs credits)',
  'generation.3d': 'Generate 3D models (costs credits)',

  // Write — marketplace
  'marketplace.list': 'Create marketplace listings',
  'marketplace.submit': 'Submit to canon',

  // Write — collaboration
  'collab.propose': 'Propose collaborations',

  // Solana — cross-chain ops via Circle DCW. Distinct from EVM scopes
  // because the trust model is different (Solana cNFT mints are gas-paid
  // by the platform, EVM mints aren't).
  'solana.mint': 'Mint Bubblegum cNFT episodes on Solana',
  'solana.canonize': 'Promote a Solana cNFT to canon (mints a Core asset)',
  'solana.pay': 'Create Solana Pay payment intents',
  'solana.bridge': 'Initiate $LOAR cross-chain transfers (custodial bridge)',

  // MCP relay meta-scope — inherits all non-admin scopes. Keys with this
  // scope are treated as MCP servers relaying on behalf of an end-user.
  // See docs/prd-mcp-integration.md §1.
  mcp_server: 'MCP relay (inherits all non-admin scopes)',

  // Admin (should never be granted to external keys)
  'admin.all': 'Full admin access (internal only)',
} as const;

export type ApiKeyScope = keyof typeof API_KEY_SCOPES;

/**
 * Validate that all permissions in an array are known scopes.
 * Rejects unknown strings to prevent scope creep.
 */
export function validatePermissions(permissions: string[]): permissions is ApiKeyScope[] {
  const validScopes = new Set(Object.keys(API_KEY_SCOPES));
  return permissions.every((p) => validScopes.has(p));
}

/**
 * Check if a key has a specific permission scope.
 * Supports wildcard 'admin.all' which grants everything.
 * `mcp_server` inherits every non-admin scope.
 */
export function hasPermission(keyDoc: ApiKeyDoc, scope: ApiKeyScope): boolean {
  return hasScope(keyDoc.permissions, scope);
}

/**
 * Stateless permission check used by the tRPC middleware. Accepts the
 * raw permissions array from AuthUser.apiKeyPermissions — avoids
 * passing the whole keyDoc through context.
 *
 * Inheritance rules:
 *   - `admin.all`       grants every scope (internal keys only).
 *   - `mcp_server`      grants every scope EXCEPT `admin.all`.
 *   - anything else     only grants that exact scope.
 */
export function hasScope(perms: string[] | undefined | null, scope: string): boolean {
  if (!perms || perms.length === 0) return true; // JWT / no-api-key → full access
  if (perms.includes('admin.all')) return true;
  if (perms.includes('mcp_server') && scope !== 'admin.all') return true;
  return perms.includes(scope);
}

/** Returns true if this key is an MCP relay (receives higher rate limits, endUserAddress passthrough). */
export function isMcpServerKey(perms: string[] | undefined | null): boolean {
  return !!perms?.includes('mcp_server');
}

/**
 * Decide whether an MCP relay key may impersonate the given end-user address.
 *
 * Rules (fail-closed):
 *   1. Key must be an `mcp_server` key.
 *   2. Address always allowed if it equals the key's `ownerUid` (gateway pattern:
 *      one MCP key minted per wallet, can only act for itself).
 *   3. Otherwise, address must appear in `allowedEndUserAddresses` (opt-in for
 *      multi-tenant relays).
 *   4. Anything else → false. The auth layer treats this as a rejected request
 *      so impersonation attempts are loud, not silently downgraded.
 *
 * `address` and stored entries are compared lower-case.
 */
export function isEndUserAddressAllowed(keyDoc: ApiKeyDoc, address: string): boolean {
  if (!isMcpServerKey(keyDoc.permissions)) return false;
  const target = address.toLowerCase();
  if (target === keyDoc.ownerUid.toLowerCase()) return true;
  const allow = keyDoc.allowedEndUserAddresses;
  if (!allow || allow.length === 0) return false;
  return allow.includes(target);
}

/** Default rate limits per-key-per-minute for mcp_server vs direct keys. */
export const MCP_SERVER_RATE_LIMIT = 300;
export const DIRECT_KEY_RATE_LIMIT = 60;

// ── Types ──────────────────────────────────────────────────────────────

export interface ApiKeyDoc {
  id: string;
  keyHash: string; // SHA-256 of full key
  keyPrefix: string; // first 12 chars for identification
  name: string; // human-readable label
  ownerUid: string; // wallet address of key creator
  aiAgentId: string | null; // linked AI agent (if any)
  permissions: string[]; // scoped permissions
  /**
   * Explicit allowlist of end-user wallet addresses this key may impersonate
   * via `X-Loar-End-User-Address`. Only meaningful for `mcp_server` keys.
   * If unset/empty, the header is only honoured when it equals `ownerUid` —
   * which is the gateway-minted-per-wallet pattern.
   * All entries are stored lower-case.
   */
  allowedEndUserAddresses?: string[];
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
  /** "mcp_server" for MCP relay keys, "direct" for everything else. */
  keyType?: 'mcp_server' | 'direct';
  /** End-user wallet address passed through by an MCP relay (see docs/prd-mcp-integration.md §1). */
  endUserAddress?: string;
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

// INF-6: per-key concurrency cap. Rate limit bounds requests-per-minute but
// says nothing about how many long-running jobs (video render, 3D gen, VLM
// extraction) a single key can have in flight. A compromised or abusive key
// could start 500 video generations before the RPM limit kicked in. This
// counter is decremented by `releaseKeyConcurrencySlot` when the caller
// finishes its work (typically in a `finally`).
const concurrencyMap = new Map<string, number>();
const MAX_CONCURRENT_PER_KEY_DEFAULT = 8;
const MAX_CONCURRENT_PER_MCP_KEY_DEFAULT = 32;

export function acquireKeyConcurrencySlot(keyId: string, isMcp: boolean): boolean {
  const cap = isMcp ? MAX_CONCURRENT_PER_MCP_KEY_DEFAULT : MAX_CONCURRENT_PER_KEY_DEFAULT;
  const current = concurrencyMap.get(keyId) ?? 0;
  if (current >= cap) return false;
  concurrencyMap.set(keyId, current + 1);
  return true;
}

export function releaseKeyConcurrencySlot(keyId: string): void {
  const current = concurrencyMap.get(keyId) ?? 0;
  if (current <= 1) concurrencyMap.delete(keyId);
  else concurrencyMap.set(keyId, current - 1);
}

// ── Key Generation ─────────────────────────────────────────────────────

/**
 * Generate a new API key. Returns the raw key (only shown once) and the doc.
 */
export async function generateApiKey(params: {
  name: string;
  ownerUid: string;
  aiAgentId?: string;
  permissions: string[];
  /**
   * Allowlist of end-user addresses this key may relay for. Only meaningful
   * for `mcp_server` keys. Stored lower-case. The owner address is implicitly
   * allowed and does not need to be repeated here.
   */
  allowedEndUserAddresses?: string[];
  rateLimitPerMinute?: number;
  expiresInDays?: number;
}): Promise<{ rawKey: string; keyDoc: ApiKeyDoc }> {
  // Validate permissions against known scopes
  if (!validatePermissions(params.permissions)) {
    const validScopes = Object.keys(API_KEY_SCOPES);
    const invalid = params.permissions.filter((p) => !validScopes.includes(p));
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid API key permissions: ${invalid.join(', ')}. Valid scopes: ${validScopes.join(', ')}`,
    });
  }

  // Prevent external keys from getting admin access
  if (params.permissions.includes('admin.all')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Cannot grant admin.all scope to API keys',
    });
  }

  const randomPart = randomBytes(24).toString('hex');
  const agentPart = params.aiAgentId || 'global';
  const rawKey = `loar_${agentPart.slice(0, 8)}_${randomPart}`;
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 16);

  // MCP-relay keys fan out many end-user requests and need a larger bucket.
  const defaultRateLimit = isMcpServerKey(params.permissions)
    ? MCP_SERVER_RATE_LIMIT
    : DIRECT_KEY_RATE_LIMIT;

  const normalizedAllow = (params.allowedEndUserAddresses ?? [])
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a));

  const doc: Omit<ApiKeyDoc, 'id'> = {
    keyHash,
    keyPrefix,
    name: params.name,
    ownerUid: params.ownerUid,
    aiAgentId: params.aiAgentId || null,
    permissions: params.permissions,
    allowedEndUserAddresses: normalizedAllow.length > 0 ? normalizedAllow : undefined,
    rateLimitPerMinute: params.rateLimitPerMinute ?? defaultRateLimit,
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
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'API key rate limit exceeded' });
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
 *
 * `keyType` is derived from the key's scopes by the caller. `endUserAddress`
 * is populated only for MCP relays that forwarded `X-Loar-End-User-Address`.
 */
export async function trackApiKeyUsage(params: {
  keyId: string;
  endpoint: string;
  creditsUsed?: number;
  keyType?: 'mcp_server' | 'direct';
  endUserAddress?: string;
}): Promise<void> {
  try {
    const doc: Record<string, unknown> = {
      apiKeyId: params.keyId,
      endpoint: params.endpoint,
      creditsUsed: params.creditsUsed ?? 0,
      timestamp: new Date(),
    };
    if (params.keyType) doc.keyType = params.keyType;
    if (params.endUserAddress) doc.endUserAddress = params.endUserAddress;
    await apiKeyUsageCol().add(doc);
  } catch (err) {
    console.error('Failed to track API key usage:', err);
  }
}

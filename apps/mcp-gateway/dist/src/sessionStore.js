import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
// ── Encryption-at-rest for cached API keys ─────────────────────────────
// The MCP `loar_*` key cached for a wallet is the literal credential the
// upstream LOAR server matches via SHA-256 — i.e. anyone who reads the
// cache (Redis dump, Firestore export) can act as that wallet for up to
// the cache TTL. Encrypt with AES-256-GCM keyed off MCP_KEY_CACHE_SECRET
// (rotated independently of OAUTH_JWT_SECRET) so a backing-store leak is
// not equivalent to credential exfiltration.
function getCacheEncryptionKey() {
    const secret = process.env.MCP_KEY_CACHE_SECRET ||
        process.env.OAUTH_JWT_SECRET || // fall back to JWT secret if dedicated one absent
        '';
    if (!secret) {
        throw new Error('MCP_KEY_CACHE_SECRET (or fallback OAUTH_JWT_SECRET) required to cache MCP keys');
    }
    // Derive a stable 32-byte key from the configured secret.
    return createHash('sha256').update(secret).digest();
}
function encryptCachedKey(plain) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', getCacheEncryptionKey(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: v1:<iv-hex>:<tag-hex>:<ciphertext-hex>
    return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}
function decryptCachedKey(blob) {
    // Backwards-compat: pre-encryption entries were stored as raw `loar_*` keys.
    // Treat anything missing the `v1:` prefix as plaintext to avoid forced
    // mass-eviction during the migration window.
    if (!blob.startsWith('v1:'))
        return blob;
    const parts = blob.split(':');
    if (parts.length !== 4)
        return null;
    try {
        const iv = Buffer.from(parts[1], 'hex');
        const tag = Buffer.from(parts[2], 'hex');
        const ct = Buffer.from(parts[3], 'hex');
        const decipher = createDecipheriv('aes-256-gcm', getCacheEncryptionKey(), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    }
    catch {
        // Tag mismatch (key rotated, payload tampered) → invalidate the cache entry.
        return null;
    }
}
// ── In-memory backend ──────────────────────────────────────────────────
const PENDING_TTL_MS = 10 * 60 * 1000;
const BOUND_TTL_MS = 2 * 60 * 1000;
class MemoryBackend {
    pending = new Map();
    bound = new Map();
    keys = new Map();
    constructor() {
        setInterval(() => this.prune(), 30_000).unref();
    }
    prune() {
        const now = Date.now();
        for (const [k, v] of this.pending) {
            if (now - v.createdAt > PENDING_TTL_MS)
                this.pending.delete(k);
        }
        for (const [k, v] of this.bound) {
            if (now - v.createdAt > BOUND_TTL_MS)
                this.bound.delete(k);
        }
        for (const [k, v] of this.keys) {
            if (now > v.expiresAt)
                this.keys.delete(k);
        }
    }
    async savePendingAuthorization(code, authz) {
        this.pending.set(code, authz);
    }
    async consumePendingAuthorization(code) {
        const authz = this.pending.get(code);
        if (!authz)
            return null;
        this.pending.delete(code);
        if (Date.now() - authz.createdAt > PENDING_TTL_MS)
            return null;
        return authz;
    }
    async bindAuthorizationToWallet(code, walletAddress, pending) {
        this.bound.set(code, { ...pending, walletAddress, createdAt: Date.now() });
    }
    async consumeBoundAuthorization(code) {
        const authz = this.bound.get(code);
        if (!authz)
            return null;
        this.bound.delete(code);
        if (Date.now() - authz.createdAt > BOUND_TTL_MS)
            return null;
        const { createdAt, ...rest } = authz;
        void createdAt;
        return rest;
    }
    async cacheApiKey(walletAddress, rawKey, ttlMs) {
        this.keys.set(walletAddress.toLowerCase(), {
            rawKey: encryptCachedKey(rawKey),
            expiresAt: Date.now() + ttlMs,
        });
    }
    async getCachedApiKey(walletAddress) {
        const entry = this.keys.get(walletAddress.toLowerCase());
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.keys.delete(walletAddress.toLowerCase());
            return null;
        }
        return decryptCachedKey(entry.rawKey);
    }
}
// ── Redis backend ──────────────────────────────────────────────────────
const KEY_PENDING = (code) => `mcp:oauth:pending:${code}`;
const KEY_BOUND = (code) => `mcp:oauth:bound:${code}`;
const KEY_API = (address) => `mcp:oauth:key:${address.toLowerCase()}`;
class RedisBackend {
    client;
    constructor(client) {
        this.client = client;
    }
    async savePendingAuthorization(code, authz) {
        await this.client.set(KEY_PENDING(code), JSON.stringify(authz), 'PX', PENDING_TTL_MS);
    }
    async consumePendingAuthorization(code) {
        const key = KEY_PENDING(code);
        // GETDEL atomically returns + deletes so the same code can't be
        // consumed twice across instances.
        const raw = await this.client.call('GETDEL', key);
        if (typeof raw !== 'string')
            return null;
        try {
            const authz = JSON.parse(raw);
            if (Date.now() - authz.createdAt > PENDING_TTL_MS)
                return null;
            return authz;
        }
        catch {
            return null;
        }
    }
    async bindAuthorizationToWallet(code, walletAddress, pending) {
        await this.client.set(KEY_BOUND(code), JSON.stringify({ ...pending, walletAddress, createdAt: Date.now() }), 'PX', BOUND_TTL_MS);
    }
    async consumeBoundAuthorization(code) {
        const raw = await this.client.call('GETDEL', KEY_BOUND(code));
        if (typeof raw !== 'string')
            return null;
        try {
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.createdAt > BOUND_TTL_MS)
                return null;
            const { createdAt, ...rest } = parsed;
            void createdAt;
            return rest;
        }
        catch {
            return null;
        }
    }
    async cacheApiKey(walletAddress, rawKey, ttlMs) {
        await this.client.set(KEY_API(walletAddress), encryptCachedKey(rawKey), 'PX', ttlMs);
    }
    async getCachedApiKey(walletAddress) {
        const blob = await this.client.get(KEY_API(walletAddress));
        if (!blob)
            return null;
        return decryptCachedKey(blob);
    }
}
// ── Backend selection ──────────────────────────────────────────────────
let backend = null;
async function getBackend() {
    if (backend)
        return backend;
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
        try {
            const { default: Redis } = await import('ioredis');
            const client = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                enableReadyCheck: true,
            });
            client.on('error', (err) => {
                console.error(`[sessionStore] redis error: ${err.message}`);
            });
            backend = new RedisBackend(client);
            console.error(`[sessionStore] using Redis backend (${redisUrl.replace(/\/\/[^@]*@/, '//***@')})`);
        }
        catch (err) {
            console.error('[sessionStore] redis unavailable, falling back to memory:', err);
            backend = new MemoryBackend();
        }
    }
    else {
        backend = new MemoryBackend();
        console.error('[sessionStore] REDIS_URL unset — using in-memory backend (single-process only)');
    }
    return backend;
}
// ── Public API (matches previous synchronous shape, now Promise-based) ──
export const sessionStore = {
    async savePendingAuthorization(code, authz) {
        return (await getBackend()).savePendingAuthorization(code, authz);
    },
    async consumePendingAuthorization(code) {
        return (await getBackend()).consumePendingAuthorization(code);
    },
    async bindAuthorizationToWallet(code, walletAddress, pending) {
        return (await getBackend()).bindAuthorizationToWallet(code, walletAddress, pending);
    },
    async consumeBoundAuthorization(code) {
        return (await getBackend()).consumeBoundAuthorization(code);
    },
    async cacheApiKey(walletAddress, rawKey, ttlMs) {
        return (await getBackend()).cacheApiKey(walletAddress, rawKey, ttlMs);
    },
    async getCachedApiKey(walletAddress) {
        return (await getBackend()).getCachedApiKey(walletAddress);
    },
};

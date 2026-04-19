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
        this.keys.set(walletAddress.toLowerCase(), { rawKey, expiresAt: Date.now() + ttlMs });
    }
    async getCachedApiKey(walletAddress) {
        const entry = this.keys.get(walletAddress.toLowerCase());
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.keys.delete(walletAddress.toLowerCase());
            return null;
        }
        return entry.rawKey;
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
        await this.client.set(KEY_API(walletAddress), rawKey, 'PX', ttlMs);
    }
    async getCachedApiKey(walletAddress) {
        return this.client.get(KEY_API(walletAddress));
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

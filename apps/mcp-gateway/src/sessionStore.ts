/**
 * OAuth + MCP session state.
 *
 * Dual-backed: Redis when REDIS_URL is set, in-memory otherwise. The
 * in-memory path is for local dev + single-process deployments; the
 * Redis path is required for horizontal scaling.
 *
 * What's stored where:
 *   - Pending authorizations    (10-min TTL)   → Redis SET with EX, or in-memory map
 *   - Bound authorizations      (2-min TTL)    → same
 *   - Cached per-wallet API key (30-day TTL)   → same
 *   - Live SSE sessions + transports            → in-memory only (streams can't serialize)
 *
 * For multi-instance horizontal scaling, sticky sessions at the load
 * balancer keep SSE traffic pinned to the instance that opened the
 * stream. OAuth state (authz codes, cached keys) is shared via Redis.
 */
import type Redis from 'ioredis';

// ── Types ──────────────────────────────────────────────────────────────

export interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state: string;
  createdAt: number;
}

export interface BoundAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  walletAddress: string;
}

// ── Backend contract ───────────────────────────────────────────────────

interface Backend {
  savePendingAuthorization(code: string, authz: PendingAuthorization): Promise<void>;
  consumePendingAuthorization(code: string): Promise<PendingAuthorization | null>;
  bindAuthorizationToWallet(
    code: string,
    walletAddress: string,
    pending: Omit<BoundAuthorization, 'walletAddress'>
  ): Promise<void>;
  consumeBoundAuthorization(code: string): Promise<BoundAuthorization | null>;
  cacheApiKey(walletAddress: string, rawKey: string, ttlMs: number): Promise<void>;
  getCachedApiKey(walletAddress: string): Promise<string | null>;
}

// ── In-memory backend ──────────────────────────────────────────────────

const PENDING_TTL_MS = 10 * 60 * 1000;
const BOUND_TTL_MS = 2 * 60 * 1000;

class MemoryBackend implements Backend {
  private pending = new Map<string, PendingAuthorization>();
  private bound = new Map<string, BoundAuthorization & { createdAt: number }>();
  private keys = new Map<string, { rawKey: string; expiresAt: number }>();

  constructor() {
    setInterval(() => this.prune(), 30_000).unref();
  }

  private prune() {
    const now = Date.now();
    for (const [k, v] of this.pending) {
      if (now - v.createdAt > PENDING_TTL_MS) this.pending.delete(k);
    }
    for (const [k, v] of this.bound) {
      if (now - v.createdAt > BOUND_TTL_MS) this.bound.delete(k);
    }
    for (const [k, v] of this.keys) {
      if (now > v.expiresAt) this.keys.delete(k);
    }
  }

  async savePendingAuthorization(code: string, authz: PendingAuthorization) {
    this.pending.set(code, authz);
  }

  async consumePendingAuthorization(code: string) {
    const authz = this.pending.get(code);
    if (!authz) return null;
    this.pending.delete(code);
    if (Date.now() - authz.createdAt > PENDING_TTL_MS) return null;
    return authz;
  }

  async bindAuthorizationToWallet(
    code: string,
    walletAddress: string,
    pending: Omit<BoundAuthorization, 'walletAddress'>
  ) {
    this.bound.set(code, { ...pending, walletAddress, createdAt: Date.now() });
  }

  async consumeBoundAuthorization(code: string) {
    const authz = this.bound.get(code);
    if (!authz) return null;
    this.bound.delete(code);
    if (Date.now() - authz.createdAt > BOUND_TTL_MS) return null;
    const { createdAt, ...rest } = authz;
    void createdAt;
    return rest;
  }

  async cacheApiKey(walletAddress: string, rawKey: string, ttlMs: number) {
    this.keys.set(walletAddress.toLowerCase(), { rawKey, expiresAt: Date.now() + ttlMs });
  }

  async getCachedApiKey(walletAddress: string): Promise<string | null> {
    const entry = this.keys.get(walletAddress.toLowerCase());
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.keys.delete(walletAddress.toLowerCase());
      return null;
    }
    return entry.rawKey;
  }
}

// ── Redis backend ──────────────────────────────────────────────────────

const KEY_PENDING = (code: string) => `mcp:oauth:pending:${code}`;
const KEY_BOUND = (code: string) => `mcp:oauth:bound:${code}`;
const KEY_API = (address: string) => `mcp:oauth:key:${address.toLowerCase()}`;

class RedisBackend implements Backend {
  constructor(private client: Redis) {}

  async savePendingAuthorization(code: string, authz: PendingAuthorization) {
    await this.client.set(KEY_PENDING(code), JSON.stringify(authz), 'PX', PENDING_TTL_MS);
  }

  async consumePendingAuthorization(code: string): Promise<PendingAuthorization | null> {
    const key = KEY_PENDING(code);
    // GETDEL atomically returns + deletes so the same code can't be
    // consumed twice across instances.
    const raw = await this.client.call('GETDEL', key);
    if (typeof raw !== 'string') return null;
    try {
      const authz = JSON.parse(raw) as PendingAuthorization;
      if (Date.now() - authz.createdAt > PENDING_TTL_MS) return null;
      return authz;
    } catch {
      return null;
    }
  }

  async bindAuthorizationToWallet(
    code: string,
    walletAddress: string,
    pending: Omit<BoundAuthorization, 'walletAddress'>
  ) {
    await this.client.set(
      KEY_BOUND(code),
      JSON.stringify({ ...pending, walletAddress, createdAt: Date.now() }),
      'PX',
      BOUND_TTL_MS
    );
  }

  async consumeBoundAuthorization(code: string): Promise<BoundAuthorization | null> {
    const raw = await this.client.call('GETDEL', KEY_BOUND(code));
    if (typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw) as BoundAuthorization & { createdAt: number };
      if (Date.now() - parsed.createdAt > BOUND_TTL_MS) return null;
      const { createdAt, ...rest } = parsed;
      void createdAt;
      return rest;
    } catch {
      return null;
    }
  }

  async cacheApiKey(walletAddress: string, rawKey: string, ttlMs: number) {
    await this.client.set(KEY_API(walletAddress), rawKey, 'PX', ttlMs);
  }

  async getCachedApiKey(walletAddress: string): Promise<string | null> {
    return this.client.get(KEY_API(walletAddress));
  }
}

// ── Backend selection ──────────────────────────────────────────────────

let backend: Backend | null = null;

async function getBackend(): Promise<Backend> {
  if (backend) return backend;
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      });
      client.on('error', (err: Error) => {
        console.error(`[sessionStore] redis error: ${err.message}`);
      });
      backend = new RedisBackend(client);
      console.error(
        `[sessionStore] using Redis backend (${redisUrl.replace(/\/\/[^@]*@/, '//***@')})`
      );
    } catch (err) {
      console.error('[sessionStore] redis unavailable, falling back to memory:', err);
      backend = new MemoryBackend();
    }
  } else {
    backend = new MemoryBackend();
    console.error('[sessionStore] REDIS_URL unset — using in-memory backend (single-process only)');
  }
  return backend;
}

// ── Public API (matches previous synchronous shape, now Promise-based) ──

export const sessionStore = {
  async savePendingAuthorization(code: string, authz: PendingAuthorization) {
    return (await getBackend()).savePendingAuthorization(code, authz);
  },
  async consumePendingAuthorization(code: string) {
    return (await getBackend()).consumePendingAuthorization(code);
  },
  async bindAuthorizationToWallet(
    code: string,
    walletAddress: string,
    pending: Omit<BoundAuthorization, 'walletAddress'>
  ) {
    return (await getBackend()).bindAuthorizationToWallet(code, walletAddress, pending);
  },
  async consumeBoundAuthorization(code: string) {
    return (await getBackend()).consumeBoundAuthorization(code);
  },
  async cacheApiKey(walletAddress: string, rawKey: string, ttlMs: number) {
    return (await getBackend()).cacheApiKey(walletAddress, rawKey, ttlMs);
  },
  async getCachedApiKey(walletAddress: string) {
    return (await getBackend()).getCachedApiKey(walletAddress);
  },
};

/**
 * Circuit Breaker — prevents cascading failures from external API outages.
 *
 * States:
 *   CLOSED  → normal operation, requests pass through
 *   OPEN    → all requests fail-fast (provider is down)
 *   HALF_OPEN → allow one probe request to test recovery
 *
 * Uses Redis for shared state across instances. Falls back to in-memory
 * for single-instance deployments.
 */

import { getRedisClient } from './redis';

// ── Types ──────────────────────────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** How long to wait before allowing a probe (ms) */
  resetTimeoutMs: number;
  /** How many successes in half-open to close the circuit */
  successThreshold: number;
  /** Time window for counting failures (ms) */
  windowMs: number;
}

interface CircuitStatus {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  successes: number;
  lastSuccess: number;
}

// ── Default configs per provider ───────────────────────────────────────

const DEFAULT_CONFIGS: Record<string, CircuitConfig> = {
  fal: {
    failureThreshold: 5,
    resetTimeoutMs: 30_000, // 30s cooldown
    successThreshold: 2,
    windowMs: 60_000, // 1 minute window
  },
  bytedance: {
    failureThreshold: 3,
    resetTimeoutMs: 60_000, // 1 min cooldown (slower API, give it time)
    successThreshold: 1,
    windowMs: 120_000,
  },
  elevenlabs: {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    successThreshold: 2,
    windowMs: 60_000,
  },
  meshy: {
    failureThreshold: 3,
    resetTimeoutMs: 60_000,
    successThreshold: 1,
    windowMs: 120_000,
  },
  pinata: {
    failureThreshold: 5,
    resetTimeoutMs: 15_000,
    successThreshold: 2,
    windowMs: 60_000,
  },
  lighthouse: {
    failureThreshold: 5,
    resetTimeoutMs: 15_000,
    successThreshold: 2,
    windowMs: 60_000,
  },
  rpc: {
    failureThreshold: 3,
    resetTimeoutMs: 10_000,
    successThreshold: 1,
    windowMs: 30_000,
  },
};

// ── In-memory state (fallback when Redis unavailable) ──────────────────

const memoryCircuits = new Map<string, CircuitStatus>();

function getMemoryCircuit(name: string): CircuitStatus {
  if (!memoryCircuits.has(name)) {
    memoryCircuits.set(name, {
      state: 'closed',
      failures: 0,
      lastFailure: 0,
      successes: 0,
      lastSuccess: 0,
    });
  }
  return memoryCircuits.get(name)!;
}

// ── Redis-backed state ─────────────────────────────────────────────────

const REDIS_PREFIX = 'cb:';

async function getRedisCircuit(name: string): Promise<CircuitStatus | null> {
  const client = getRedisClient();
  if (!client) return null;

  try {
    const data = await client.get(`${REDIS_PREFIX}${name}`);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

async function setRedisCircuit(name: string, status: CircuitStatus, ttlMs: number): Promise<void> {
  const client = getRedisClient();
  if (!client) return;

  try {
    await client.set(`${REDIS_PREFIX}${name}`, JSON.stringify(status), 'PX', ttlMs);
  } catch {
    // Non-fatal — in-memory continues to work
  }
}

// ── Circuit Breaker Class ──────────────────────────────────────────────

export class CircuitBreaker {
  private name: string;
  private config: CircuitConfig;

  constructor(name: string, config?: Partial<CircuitConfig>) {
    this.name = name;
    this.config = {
      ...(DEFAULT_CONFIGS[name] || DEFAULT_CONFIGS.fal),
      ...config,
    };
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const status = await this.getStatus();

    if (status.state === 'open') {
      const timeSinceLastFailure = Date.now() - status.lastFailure;
      if (timeSinceLastFailure < this.config.resetTimeoutMs) {
        throw new CircuitOpenError(this.name, this.config.resetTimeoutMs - timeSinceLastFailure);
      }
      // Transition to half-open
      await this.updateStatus({ ...status, state: 'half_open', successes: 0 });
    }

    try {
      const result = await fn();
      await this.onSuccess(status);
      return result;
    } catch (error) {
      await this.onFailure(status);
      throw error;
    }
  }

  /**
   * Check if this circuit is available (not open).
   */
  async isAvailable(): Promise<boolean> {
    const status = await this.getStatus();
    if (status.state === 'closed') return true;
    if (status.state === 'half_open') return true;
    if (status.state === 'open') {
      return Date.now() - status.lastFailure >= this.config.resetTimeoutMs;
    }
    return true;
  }

  /**
   * Get the current state of this circuit for monitoring.
   */
  async getState(): Promise<{ name: string; state: CircuitState; failures: number }> {
    const status = await this.getStatus();
    return { name: this.name, state: status.state, failures: status.failures };
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async getStatus(): Promise<CircuitStatus> {
    const redisStatus = await getRedisCircuit(this.name);
    if (redisStatus) return redisStatus;
    return getMemoryCircuit(this.name);
  }

  private async updateStatus(status: CircuitStatus): Promise<void> {
    // Update both stores
    memoryCircuits.set(this.name, status);
    await setRedisCircuit(this.name, status, this.config.windowMs * 2);
  }

  private async onSuccess(currentStatus: CircuitStatus): Promise<void> {
    const now = Date.now();
    const updated: CircuitStatus = {
      ...currentStatus,
      successes: currentStatus.successes + 1,
      lastSuccess: now,
    };

    if (currentStatus.state === 'half_open') {
      if (updated.successes >= this.config.successThreshold) {
        // Recovery confirmed — close the circuit
        updated.state = 'closed';
        updated.failures = 0;
        console.log(`[CircuitBreaker] ${this.name}: HALF_OPEN → CLOSED (recovered)`);
      }
    } else {
      // In closed state, reset failure count on success within window
      updated.state = 'closed';
    }

    await this.updateStatus(updated);
  }

  private async onFailure(currentStatus: CircuitStatus): Promise<void> {
    const now = Date.now();

    // Reset counter if outside the window
    const failures =
      now - currentStatus.lastFailure > this.config.windowMs ? 1 : currentStatus.failures + 1;

    const updated: CircuitStatus = {
      ...currentStatus,
      failures,
      lastFailure: now,
    };

    if (currentStatus.state === 'half_open') {
      // Probe failed — reopen
      updated.state = 'open';
      console.log(`[CircuitBreaker] ${this.name}: HALF_OPEN → OPEN (probe failed)`);
    } else if (failures >= this.config.failureThreshold) {
      updated.state = 'open';
      console.warn(
        `[CircuitBreaker] ${this.name}: CLOSED → OPEN (${failures} failures in ${this.config.windowMs}ms)`
      );
    }

    await this.updateStatus(updated);
  }
}

// ── Error Type ─────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  public provider: string;
  public retryAfterMs: number;

  constructor(provider: string, retryAfterMs: number) {
    super(
      `${provider} circuit breaker is OPEN — provider is experiencing issues. ` +
        `Retry in ${Math.ceil(retryAfterMs / 1000)}s.`
    );
    this.name = 'CircuitOpenError';
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
  }
}

// ── Singleton instances ────────────────────────────────────────────────

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(provider: string): CircuitBreaker {
  if (!breakers.has(provider)) {
    breakers.set(provider, new CircuitBreaker(provider));
  }
  return breakers.get(provider)!;
}

/**
 * Get all circuit breaker states for the health endpoint.
 */
export async function getAllCircuitStates() {
  const states: Record<string, { state: CircuitState; failures: number }> = {};
  for (const [name, breaker] of breakers) {
    const s = await breaker.getState();
    states[name] = { state: s.state, failures: s.failures };
  }
  return states;
}

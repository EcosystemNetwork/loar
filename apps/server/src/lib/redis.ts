/**
 * Shared Redis client — singleton, lazy-initialized from REDIS_URL env var.
 *
 * Provides connection pooling via ioredis (which manages a single multiplexed
 * TCP connection with automatic reconnection), health checks, and graceful shutdown.
 *
 * Usage:
 *   import { getRedisClient, isRedisHealthy, shutdownRedis } from './redis';
 *   const client = getRedisClient(); // null if REDIS_URL not set
 */

let redisClient: any | null = null;
let redisReady = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the Redis client. Called lazily on first getRedisClient().
 * Uses ioredis with production-grade retry and reconnection settings.
 */
async function initRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  try {
    const Redis = (await import('ioredis')).default;

    redisClient = new Redis(redisUrl, {
      // Connection pooling / retry
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 10) {
          console.error('[Redis] Max reconnection attempts (10) reached — giving up');
          return null; // stop retrying
        }
        // Exponential backoff: 200ms, 400ms, 800ms, ... capped at 5s
        const delay = Math.min(times * 200, 5000);
        console.warn(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
      lazyConnect: true,
      enableOfflineQueue: true,
      // Reconnect on close
      reconnectOnError(err: Error) {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        return targetErrors.some((t) => err.message.includes(t));
      },
    });

    // Connection event handlers
    redisClient.on('connect', () => {
      console.log('[Redis] Connected');
    });

    redisClient.on('ready', () => {
      redisReady = true;
      console.log('[Redis] Ready — accepting commands');
    });

    redisClient.on('error', (err: Error) => {
      console.error('[Redis] Error:', err.message);
    });

    redisClient.on('close', () => {
      redisReady = false;
      console.warn('[Redis] Connection closed');
    });

    redisClient.on('reconnecting', (delayMs: number) => {
      console.warn(`[Redis] Reconnecting in ${delayMs}ms`);
    });

    await redisClient.connect();
  } catch (err) {
    console.warn('[Redis] Failed to initialize:', (err as Error).message);
    redisClient = null;
    redisReady = false;
  }
}

/**
 * Returns the shared Redis client, or null if REDIS_URL is not configured
 * or connection failed. Lazy-initializes on first call.
 */
export function getRedisClient(): any | null {
  if (!process.env.REDIS_URL) return null;

  if (!initPromise) {
    initPromise = initRedis();
  }

  return redisClient;
}

/**
 * Await this to ensure Redis is initialized before using it.
 * Returns the client or null.
 */
export async function getRedisClientAsync(): Promise<any | null> {
  if (!process.env.REDIS_URL) return null;

  if (!initPromise) {
    initPromise = initRedis();
  }
  await initPromise;

  return redisClient;
}

/**
 * Health check — returns true if Redis is connected and responding to PING.
 */
export async function isRedisHealthy(): Promise<boolean> {
  if (!redisClient || !redisReady) return false;

  try {
    const result = await redisClient.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Graceful shutdown — disconnect the Redis client cleanly.
 * Safe to call multiple times or when Redis is not initialized.
 */
export async function shutdownRedis(): Promise<void> {
  if (!redisClient) return;

  try {
    console.log('[Redis] Shutting down...');
    await redisClient.quit();
    console.log('[Redis] Disconnected gracefully');
  } catch (err) {
    console.warn('[Redis] Error during shutdown, forcing disconnect:', (err as Error).message);
    try {
      redisClient.disconnect();
    } catch {
      // Already disconnected
    }
  } finally {
    redisClient = null;
    redisReady = false;
    initPromise = null;
  }
}

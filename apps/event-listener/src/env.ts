/**
 * Event-listener env validation. Loads the monorepo root .env if present,
 * then validates required keys. Service refuses to start on misconfiguration
 * because a silently-misconfigured indexer writes wrong data to production.
 */
import 'dotenv/config';
import { z } from 'zod';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load monorepo-root .env (matches server/indexer convention). Bundled output
// lives at apps/event-listener/dist/, source at apps/event-listener/src/ — both
// resolve to the repo root via the same relative walk.
loadDotenv({ path: resolve(__dirname, '../../../.env') });

const schema = z.object({
  LISTENER_CHAIN: z.enum(['sepolia', 'base-sepolia', 'base']),
  LISTENER_RPC_URL: z.string().url(),
  LISTENER_RPC_FALLBACKS: z
    .string()
    .optional()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),

  /** Chunk size for eth_getLogs backfill. Alchemy free caps at 500, paid at 5000+. */
  LISTENER_BLOCK_RANGE: z.coerce.number().int().positive().default(500),
  /** How often the live poll runs (ms). */
  LISTENER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(4000),
  /** Blocks-from-head treated as unconfirmed (re-org window). */
  LISTENER_FINALITY_DEPTH: z.coerce.number().int().nonnegative().default(15),

  /** HTTP health port. Railway overrides via PORT. */
  PORT: z.coerce.number().int().positive().default(3400),

  /** Either FIREBASE_SERVICE_ACCOUNT (JSON string) or PATH must be set. */
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  /** Mirror writes to Pinata IPFS resolver (unused by indexer but shared env). */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Event-listener env validation failed:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

// At least one Firebase credential source is required for production writes.
if (!env.FIREBASE_SERVICE_ACCOUNT && !env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  console.error(
    '❌ Event-listener requires FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH'
  );
  process.exit(1);
}

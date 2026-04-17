import { z } from 'zod';

const VALID_STORAGE_PROVIDERS = ['pinata', 'lighthouse', 'firebase'] as const;

const envSchema = z.object({
  // ── Core ──────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .default('3000')
    .transform((v) => parseInt(v, 10)),

  // ── Auth ──────────────────────────────────────────────────────────────────
  SIWE_JWT_SECRET: z
    .string()
    .min(
      64,
      'SIWE_JWT_SECRET must be at least 64 characters (256-bit). Generate with: openssl rand -hex 32'
    ),
  /** Single URL or comma-separated list (e.g. "https://loar.fun,https://staging.loar.fun") */
  CORS_ORIGIN: z.string().optional(),

  // ── Firebase ──────────────────────────────────────────────────────────────
  // At least one credential source required in production
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),

  // ── Admin ─────────────────────────────────────────────────────────────────
  ADMIN_WALLET: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'ADMIN_WALLET must be a valid Ethereum address (0x...)')
    .optional(),
  ADMIN_ADDRESSES: z.string().optional(), // comma-separated 0x addresses

  // ── Blockchain ────────────────────────────────────────────────────────────
  PRIVATE_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'PRIVATE_KEY must be 64 hex characters without 0x prefix')
    .optional(),

  // ── KMS signing (production — private key stays in HSM) ──────────────
  KMS_KEY_ID: z.string().optional(),
  KMS_REGION: z.string().default('us-east-1'),

  // ── Base mainnet RPC ─────────────────────────────────────────────────
  RPC_URL_BASE: z.string().url('RPC_URL_BASE must be a valid URL').optional(),

  // ── On-chain payment verification ─────────────────────────────────────────
  // Falls back to PONDER_RPC_URL_2 in credits.routes.ts if unset, but setting
  // this separately is recommended so server and indexer use independent RPCs.
  RPC_URL: z.string().url('RPC_URL must be a valid URL').optional(),
  /** Base Sepolia RPC — required if multi-chain purchases or Base multi-sig universes are enabled */
  RPC_URL_BASE_SEPOLIA: z.string().url('RPC_URL_BASE_SEPOLIA must be a valid URL').optional(),
  LOAR_TOKEN_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'LOAR_TOKEN_ADDRESS must be a valid Ethereum address')
    .optional(),
  TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'TREASURY_ADDRESS must be a valid Ethereum address')
    .optional(),

  // ── Redis (required for production — rate limiting, job queue, circuit breakers) ──
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL (redis://...)').optional(),

  // ── Scaling ─────────────────────────────────────────────────────────────
  MAX_CONCURRENT_GENERATIONS: z.string().default('50'),
  MAX_QUEUED_GENERATIONS: z.string().default('200'),
  WORKER_CONCURRENCY: z.string().default('5'),

  // ── Stripe (optional — enables card payments) ────────────────────────────
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // ── Platform config ───────────────────────────────────────────────────────
  UNIVERSE_MINT_CREDITS: z
    .string()
    .default('5000')
    .transform((v) => parseInt(v, 10)),

  // ── AI services ───────────────────────────────────────────────────────────
  FAL_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MESHY_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),

  // ── Storage — Pinata ──────────────────────────────────────────────────────
  PINATA_JWT: z.string().optional(),
  PINATA_GATEWAY_URL: z.string().url('PINATA_GATEWAY_URL must be a valid URL').optional(),

  // ── Storage — Lighthouse ──────────────────────────────────────────────────
  LIGHTHOUSE_API_KEY: z.string().optional(),

  // ── Indexer RPC (fallback) ─────────────────────────────────────────────────
  /** Used as fallback when RPC_URL is unset. Shared with the Ponder indexer. */
  PONDER_RPC_URL_2: z.string().url('PONDER_RPC_URL_2 must be a valid URL').optional(),

  // ── Storage — priority ────────────────────────────────────────────────────
  STORAGE_PROVIDER_PRIORITY: z
    .string()
    .optional()
    .transform((v) => v ?? 'pinata,lighthouse,firebase')
    .refine((v) => v.split(',').every((p) => VALID_STORAGE_PROVIDERS.includes(p.trim() as never)), {
      message: `STORAGE_PROVIDER_PRIORITY must be a comma-separated list of: ${VALID_STORAGE_PROVIDERS.join(', ')}`,
    }),

  // ── Contract addresses (used by various routers) ────────────────────────
  PLATFORM_TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'PLATFORM_TREASURY_ADDRESS must be a valid Ethereum address')
    .optional(),
  SPLIT_ROUTER_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'SPLIT_ROUTER_ADDRESS must be a valid Ethereum address')
    .optional(),
  LAUNCHPAD_STAKING_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'LAUNCHPAD_STAKING_ADDRESS must be a valid Ethereum address')
    .optional(),

  // ── Auth domains ────────────────────────────────────────────────────────
  SIWE_ALLOWED_DOMAINS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`\n❌ Environment validation failed:\n${errors}\n`);
    console.error('Check apps/server/.env.example for required variables.\n');
    process.exit(1);
  }

  const env = result.data;

  // Production-specific checks
  if (env.NODE_ENV === 'production') {
    const prodErrors: string[] = [];

    if (!env.CORS_ORIGIN) {
      prodErrors.push('CORS_ORIGIN must be set in production (e.g. https://loar.fun)');
    }

    if (!env.FIREBASE_SERVICE_ACCOUNT && !env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      prodErrors.push(
        'Either FIREBASE_SERVICE_ACCOUNT (JSON string) or FIREBASE_SERVICE_ACCOUNT_PATH (file path) is required in production'
      );
    }

    if (!env.LOAR_TOKEN_ADDRESS) {
      prodErrors.push(
        'LOAR_TOKEN_ADDRESS is required in production for on-chain payment verification'
      );
    }

    if (!env.TREASURY_ADDRESS) {
      prodErrors.push(
        'TREASURY_ADDRESS is required in production for on-chain payment verification'
      );
    }

    if (!env.RPC_URL) {
      prodErrors.push(
        'RPC_URL is required in production (fallback to PONDER_RPC_URL_2 is not reliable for payment verification)'
      );
    }

    if (!env.RPC_URL_BASE_SEPOLIA) {
      prodErrors.push(
        'RPC_URL_BASE_SEPOLIA is required in production for multi-chain payment verification and Base multi-sig admin checks'
      );
    }

    if (!env.ADMIN_ADDRESSES && !env.ADMIN_WALLET) {
      prodErrors.push(
        'At least one of ADMIN_ADDRESSES or ADMIN_WALLET must be set in production for admin authorization'
      );
    }

    if (!env.REDIS_URL) {
      console.warn(
        '⚠️  REDIS_URL is not set — rate limiting, job queues, and circuit breakers will use in-memory fallbacks. ' +
          'This means no horizontal scaling and data loss on restart. Set REDIS_URL for production.'
      );
    }

    if (!env.KMS_KEY_ID && env.PRIVATE_KEY) {
      console.warn(
        '⚠️  PRIVATE_KEY is set in production without KMS_KEY_ID — consider migrating to AWS KMS for HSM-backed signing'
      );
    }

    if (!env.KMS_KEY_ID && !env.PRIVATE_KEY) {
      prodErrors.push(
        'Either KMS_KEY_ID (recommended) or PRIVATE_KEY must be set for on-chain signing'
      );
    }

    if (prodErrors.length > 0) {
      console.error(`\n❌ Production environment checks failed:`);
      prodErrors.forEach((e) => console.error(`  - ${e}`));
      console.error('');
      process.exit(1);
    }
  }

  return env;
}

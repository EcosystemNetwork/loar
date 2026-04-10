import { z } from 'zod';

const VALID_STORAGE_PROVIDERS = ['pinata', 'lighthouse', 'storacha', 'firebase'] as const;

const envSchema = z.object({
  // ── Core ──────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .default('3000')
    .transform((v) => parseInt(v, 10)),

  // ── Auth ──────────────────────────────────────────────────────────────────
  SIWE_JWT_SECRET: z.string().min(32, 'SIWE_JWT_SECRET must be at least 32 characters'),
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

  // ── On-chain payment verification ─────────────────────────────────────────
  // Falls back to PONDER_RPC_URL_2 in credits.routes.ts if unset, but setting
  // this separately is recommended so server and indexer use independent RPCs.
  RPC_URL: z.string().url('RPC_URL must be a valid URL').optional(),
  LOAR_TOKEN_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'LOAR_TOKEN_ADDRESS must be a valid Ethereum address')
    .optional(),
  TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'TREASURY_ADDRESS must be a valid Ethereum address')
    .optional(),

  // ── Redis (optional — enables distributed rate limiting) ──────────────────
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL (redis://...)').optional(),

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

  // ── Storage — Storacha ────────────────────────────────────────────────────
  STORACHA_KEY: z.string().optional(),
  STORACHA_PROOF: z.string().optional(),

  // ── Storage — priority ────────────────────────────────────────────────────
  STORAGE_PROVIDER_PRIORITY: z
    .string()
    .optional()
    .transform((v) => v ?? 'pinata,lighthouse,storacha,firebase')
    .refine((v) => v.split(',').every((p) => VALID_STORAGE_PROVIDERS.includes(p.trim() as never)), {
      message: `STORAGE_PROVIDER_PRIORITY must be a comma-separated list of: ${VALID_STORAGE_PROVIDERS.join(', ')}`,
    }),
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

    if (prodErrors.length > 0) {
      console.error(`\n❌ Production environment checks failed:`);
      prodErrors.forEach((e) => console.error(`  - ${e}`));
      console.error('');
      process.exit(1);
    }
  }

  return env;
}

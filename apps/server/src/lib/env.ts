import { z } from 'zod';

const envSchema = z.object({
  // Required in production, optional in dev
  CORS_ORIGIN: z.string().url().optional(),
  SIWE_JWT_SECRET: z.string().min(1, 'SIWE_JWT_SECRET is required for authentication'),

  // Server
  PORT: z
    .string()
    .default('3000')
    .transform((v) => parseInt(v, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Firebase — at least one credential source required
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  // AI services — optional, server starts without them
  FAL_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Blockchain
  PRIVATE_KEY: z.string().optional(),

  // Storage
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  WALRUS_PUBLISHER_URL: z.string().url().optional(),
  WALRUS_AGGREGATOR_URL: z.string().url().optional(),
  PINATA_JWT: z.string().optional(),
  PINATA_GATEWAY_URL: z.string().url().optional(),
  STORAGE_PROVIDER_PRIORITY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`\n❌ Environment validation failed:\n${errors}\n`);
    console.error('Check .env.example for required variables and correct formats.\n');
    process.exit(1);
  }

  const env = result.data;

  // Production-specific checks
  if (env.NODE_ENV === 'production') {
    const prodErrors: string[] = [];

    if (!env.CORS_ORIGIN) {
      prodErrors.push('CORS_ORIGIN must be set in production');
    }

    if (!env.FIREBASE_SERVICE_ACCOUNT && !env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      prodErrors.push(
        'Either FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH is required in production'
      );
    }

    if (prodErrors.length > 0) {
      console.error(`\n❌ Production environment validation failed:`);
      prodErrors.forEach((e) => console.error(`  - ${e}`));
      console.error('');
      process.exit(1);
    }
  }

  return env;
}

import { z } from 'zod';

/**
 * Validates all VITE_ environment variables at startup.
 * All vars in this schema are browser-safe (public) by design.
 * Never add secrets here — VITE_ vars are baked into the JS bundle.
 */
const envSchema = z.object({
  // ── Required ──────────────────────────────────────────────────────────────
  VITE_SERVER_URL: z.string().min(1, 'VITE_SERVER_URL is required'),

  // ── Optional endpoints ────────────────────────────────────────────────────
  VITE_PONDER_URL: z.string().optional(),

  // ── Blockchain (public addresses) ─────────────────────────────────────────
  VITE_LOAR_TOKEN_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'VITE_LOAR_TOKEN_ADDRESS must be a valid Ethereum address')
    .optional(),
  VITE_TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'VITE_TREASURY_ADDRESS must be a valid Ethereum address')
    .optional(),

  // ── Admin (comma-separated public addresses) ───────────────────────────────
  VITE_ADMIN_ADDRESSES: z.string().optional(),

  // ── Coinbase Developer Platform (project ID only — not API secret) ─────────
  VITE_CDP_PROJECT_ID: z.string().optional(),

  // ── Firebase web client config (public — not admin credentials) ────────────
  VITE_FIREBASE_PROJECT_ID: z.string().optional(),
  VITE_FIREBASE_API_KEY: z.string().optional(),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().optional(),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().optional(),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  VITE_FIREBASE_APP_ID: z.string().optional(),
});

export type WebEnv = z.infer<typeof envSchema>;

export function validateWebEnv(): WebEnv {
  const result = envSchema.safeParse(import.meta.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    const msg = `Environment validation failed:\n${errors}\n\nCheck apps/web/.env.example for required variables.`;

    if (import.meta.env.PROD) {
      throw new Error(msg);
    }
    console.error(`[env] ${msg}`);
  }

  // Dev-only: warn about unset optional vars that affect features
  if (import.meta.env.DEV && result.success) {
    const featureVars = [
      'VITE_PONDER_URL',
      'VITE_LOAR_TOKEN_ADDRESS',
      'VITE_TREASURY_ADDRESS',
    ] as const;
    const unset = featureVars.filter((k) => !result.data[k]);
    if (unset.length > 0) {
      console.info(
        `[env] Optional vars not set (some features may be disabled): ${unset.join(', ')}`
      );
    }
  }

  return result.success ? result.data : ({} as WebEnv);
}

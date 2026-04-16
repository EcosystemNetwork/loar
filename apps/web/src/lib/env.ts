import { z } from 'zod';

/**
 * Validates all VITE_ environment variables at startup.
 * All vars in this schema are browser-safe (public) by design.
 * Never add secrets here — VITE_ vars are baked into the JS bundle.
 */
const envSchema = z.object({
  // ── Server URL (falls back to relative path if unset) ─────────────────────
  VITE_SERVER_URL: z.string().optional(),

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

  // ── Thirdweb (client ID — public, not secret) ──────────────────────────────
  VITE_THIRDWEB_CLIENT_ID: z.string().optional(),

  // ── WalletConnect (project ID — public) ───────────────────────────────────
  VITE_WALLETCONNECT_PROJECT_ID: z.string().optional(),

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

    // Log but don't crash — missing optional vars shouldn't kill the app
    console.error(`[env] ${msg}`);
  }

  // Warn about unset optional vars that affect features
  if (result.success) {
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

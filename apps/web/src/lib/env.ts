import { z } from 'zod';

/**
 * Validates all VITE_ environment variables at startup.
 * All vars in this schema are browser-safe (public) by design.
 * Never add secrets here — VITE_ vars are baked into the JS bundle.
 */

/** Coerces empty strings to undefined so `.optional()` correctly skips unset Vite env vars */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/**
 * Drops empty strings and placeholder values (e.g. "0x...") to undefined
 * so an unfilled `.env.example` entry does not surface as a validation error.
 */
const optionalAddress = z.preprocess((v) => {
  if (typeof v !== 'string' || v === '') return undefined;
  if (!ADDRESS_RE.test(v)) {
    if (typeof console !== 'undefined') {
      console.info(`[env] Ignoring placeholder/invalid address value: "${v}"`);
    }
    return undefined;
  }
  return v;
}, z.string().regex(ADDRESS_RE).optional());

const envSchema = z.object({
  // ── Server URL (falls back to relative path if unset) ─────────────────────
  VITE_SERVER_URL: optionalString,

  // ── Optional endpoints ────────────────────────────────────────────────────
  VITE_PONDER_URL: optionalString,

  // ── IPFS gateway (public) ─────────────────────────────────────────────────
  VITE_PINATA_GATEWAY_URL: optionalString,
  VITE_PINATA_GATEWAY_TOKEN: optionalString,

  // ── Blockchain (public addresses) ─────────────────────────────────────────
  // $LOAR token + faucet addresses come from `configs/addresses.ts` per-chain.
  // Treasury is a chain-independent EOA so we keep it as an env var.
  VITE_TREASURY_ADDRESS: optionalAddress,

  // ── Admin (comma-separated public addresses) ───────────────────────────────
  VITE_ADMIN_ADDRESSES: optionalString,

  // ── Thirdweb (client ID — public, not secret) ──────────────────────────────
  VITE_THIRDWEB_CLIENT_ID: optionalString,

  // ── WalletConnect (project ID — public) ───────────────────────────────────
  VITE_WALLETCONNECT_PROJECT_ID: optionalString,

  // ── Firebase web client config (public — not admin credentials) ────────────
  VITE_FIREBASE_PROJECT_ID: optionalString,
  VITE_FIREBASE_API_KEY: optionalString,
  VITE_FIREBASE_AUTH_DOMAIN: optionalString,
  VITE_FIREBASE_STORAGE_BUCKET: optionalString,
  VITE_FIREBASE_MESSAGING_SENDER_ID: optionalString,
  VITE_FIREBASE_APP_ID: optionalString,

  // ── Monitoring (Sentry DSN is public by design — safe in the client bundle) ─
  VITE_SENTRY_DSN: optionalString,
  VITE_RELEASE: optionalString,

  // ── Product analytics (PostHog) — public project API key, safe in bundle ──
  VITE_POSTHOG_KEY: optionalString,
  VITE_POSTHOG_HOST: optionalString,
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
    const featureVars = ['VITE_PONDER_URL', 'VITE_TREASURY_ADDRESS'] as const;
    const unset = featureVars.filter((k) => !result.data[k]);
    if (unset.length > 0) {
      console.info(
        `[env] Optional vars not set (some features may be disabled): ${unset.join(', ')}`
      );
    }
  }

  return result.success ? result.data : ({} as WebEnv);
}

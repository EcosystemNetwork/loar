/**
 * Validates required VITE_ environment variables at startup.
 * Logs warnings in development, throws in production builds.
 */
const required = ['VITE_SERVER_URL'] as const;
const optional = ['VITE_PONDER_URL', 'VITE_ADMIN_ADDRESSES'] as const;

export function validateWebEnv() {
  const missing = required.filter((key) => !import.meta.env[key]);

  if (missing.length > 0) {
    const msg = `Missing required env vars: ${missing.join(', ')}. Check .env at repo root.`;
    if (import.meta.env.PROD) {
      throw new Error(msg);
    }
    console.warn(`[env] ${msg}`);
  }

  if (import.meta.env.DEV) {
    const unset = optional.filter((key) => !import.meta.env[key]);
    if (unset.length > 0) {
      console.info(`[env] Optional vars not set: ${unset.join(', ')}`);
    }
  }
}

/**
 * Indexer environment validation.
 * Loaded before ponder.config.ts — exits immediately on missing required vars.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In production each service gets its own env file; fall back to root for local dev.
const localEnv = path.resolve(__dirname, '.env');
const rootEnv = path.resolve(__dirname, '../../.env');

dotenv.config({ path: localEnv }); // prefer apps/indexer/.env if present
dotenv.config({ path: rootEnv }); // fall back to root .env (local dev)

const REQUIRED = ['PONDER_RPC_URL_2'] as const;

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`\n❌ Indexer environment validation failed:`);
  missing.forEach((key) => console.error(`  - ${key} is required`));
  console.error('\nCheck apps/indexer/.env.example for required variables.\n');
  process.exit(1);
}

export const env = {
  PONDER_RPC_URL: process.env.PONDER_RPC_URL_2 as string,
} as const;

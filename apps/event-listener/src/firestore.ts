/**
 * Firebase Admin init mirroring apps/server/src/lib/firebase.ts so both
 * services accept the same env vars and service-account shape. Differs in
 * that event-listener refuses to start without real credentials — degraded
 * mode is not a valid state for an indexer.
 */
import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { env } from './env.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadServiceAccount(): ServiceAccount {
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      if (parsed.project_id && parsed.private_key) return parsed;
      throw new Error('FIREBASE_SERVICE_ACCOUNT missing project_id or private_key');
    } catch (err) {
      logger.fatal({ err }, 'Failed to parse FIREBASE_SERVICE_ACCOUNT');
      process.exit(1);
    }
  }
  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const absPath = resolve(__dirname, '../../../', env.FIREBASE_SERVICE_ACCOUNT_PATH);
    try {
      return JSON.parse(readFileSync(absPath, 'utf-8'));
    } catch (err) {
      logger.fatal({ err, absPath }, 'Failed to read FIREBASE_SERVICE_ACCOUNT_PATH');
      process.exit(1);
    }
  }
  // env.ts already guards this; redundant check for type narrowing.
  logger.fatal('No Firebase credentials configured');
  process.exit(1);
}

const app = initializeApp({ credential: cert(loadServiceAccount()) });
export const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
logger.info('Firestore initialized');

/**
 * Firebase Admin SDK initialization.
 * Loads service account credentials from env (JSON string or file path)
 * and exports a Firestore instance for server-side data storage.
 * Falls back to degraded mode if credentials are missing or invalid.
 *
 * Call initFirebase() after dotenv.config() to initialize.
 */
import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: ReturnType<typeof getFirestore> = null as any;
let firebaseAvailable = false;

export function initFirebase() {
  let serviceAccount: ServiceAccount | undefined;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (
        parsed.project_id &&
        parsed.project_id !== '...' &&
        parsed.private_key &&
        parsed.private_key !== '...'
      ) {
        serviceAccount = parsed;
      } else {
        console.warn(
          'FIREBASE_SERVICE_ACCOUNT contains placeholder values — skipping Firebase init'
        );
      }
    } catch {
      console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT');
    }
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      const absPath = resolve(__dirname, '../../../../', process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      serviceAccount = JSON.parse(readFileSync(absPath, 'utf-8'));
    } catch (err) {
      console.warn('Failed to read FIREBASE_SERVICE_ACCOUNT_PATH:', (err as Error).message);
    }
  }

  if (serviceAccount) {
    try {
      const app = initializeApp({ credential: cert(serviceAccount) });
      db = getFirestore(app);
      db.settings({ ignoreUndefinedProperties: true });
      firebaseAvailable = true;
      console.log('Firebase Admin SDK initialized successfully');
    } catch (err) {
      console.warn('Firebase Admin SDK init failed:', (err as Error).message);
    }
  } else {
    console.warn(
      'No valid Firebase credentials — running in degraded mode (in-memory nonces, no Firestore)'
    );
  }
}

export { db, firebaseAvailable };

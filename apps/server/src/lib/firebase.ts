/**
 * Firebase Admin SDK initialization.
 * Loads service account credentials from env (JSON string or file path)
 * and exports Firestore and Auth instances for server-side use.
 * Falls back to degraded mode if credentials are missing or invalid.
 */
import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';

let serviceAccount: ServiceAccount | undefined;
let firebaseAvailable = false;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    // Check for placeholder values
    if (parsed.project_id && parsed.project_id !== '...' && parsed.private_key && parsed.private_key !== '...') {
      serviceAccount = parsed;
    } else {
      console.warn('FIREBASE_SERVICE_ACCOUNT contains placeholder values — skipping Firebase init');
    }
  } catch {
    console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT');
  }
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  try {
    serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf-8'));
  } catch {
    console.warn('Failed to read FIREBASE_SERVICE_ACCOUNT_PATH');
  }
}

let db: ReturnType<typeof getFirestore>;
let adminAuth: ReturnType<typeof getAuth>;

if (serviceAccount) {
  try {
    const app = initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore(app);
    adminAuth = getAuth(app);
    firebaseAvailable = true;
  } catch (err) {
    console.warn('Firebase Admin SDK init failed:', (err as Error).message);
    db = null as any;
    adminAuth = null as any;
  }
} else {
  console.warn('No valid Firebase credentials — running in degraded mode (in-memory nonces, no Firestore)');
  db = null as any;
  adminAuth = null as any;
}

export { db, adminAuth, firebaseAvailable };

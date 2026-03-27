/**
 * Firebase Client SDK Initialization
 *
 * Configures the Firebase app and Auth instances using Vite environment variables.
 * All VITE_FIREBASE_* vars are read from the root .env file via Vite's envDir setting.
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Singleton Firebase app instance. */
export const firebaseApp = initializeApp(firebaseConfig);

/** Firebase Auth instance used by auth-client.ts and trpc.ts for token retrieval. */
export const auth = getAuth(firebaseApp);

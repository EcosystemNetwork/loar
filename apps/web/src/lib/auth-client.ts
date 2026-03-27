/**
 * Firebase Authentication Client
 *
 * Provides the `useAuth` hook for reactive auth state and helper functions
 * for email/password sign-in, sign-up, and sign-out. The auth instance is
 * re-exported from `lib/firebase.ts` for convenience.
 */

import { auth } from './firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { useState, useEffect } from 'react';

/**
 * Subscribes to Firebase auth state changes.
 * @returns `{ user, loading }` -- `user` is null when signed out, `loading` is true until the first auth check completes.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { user, loading };
}

/**
 * Signs in with email and password.
 * @param email - User's email address
 * @param password - User's password
 * @returns Firebase UserCredential
 */
export async function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

/**
 * Creates a new account and sets the display name.
 * @param email - User's email address
 * @param password - User's password
 * @param name - Display name to set on the new profile
 * @returns Firebase UserCredential
 */
export async function signUp(email: string, password: string, name: string) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  return cred;
}

/** Signs out the current user and clears the Firebase session. */
export async function signOut() {
  return firebaseSignOut(auth);
}

export { auth };

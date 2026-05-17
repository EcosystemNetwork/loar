/**
 * Side-effect import that switches a test file from the global empty-Firestore
 * mock (set up in `setup.ts`) over to a REAL `firebase-admin` client pointing
 * at a locally-running Firestore Emulator.
 *
 * Test files just do:
 *
 *   import './_real-firebase';
 *
 * at the top of the file. The `vi.mock` call has to live at module top-level
 * (Vitest 5 deprecates inner-scope `vi.mock`) so we can't wrap it in a
 * function — importing the module IS the opt-in.
 *
 * Why the emulator and not the production project: `firebase-service-account.json`
 * was rotated, so this machine can't auth to `loar-db` directly. The emulator
 * runs the actual Firestore server code locally — same wire protocol, same
 * query semantics, same default-deny-undefined, real transactions.
 *
 * Prerequisite (one-time per machine):
 *   firebase emulators:start --only firestore --project loar-db
 */
import { vi, beforeAll, afterEach } from 'vitest';

const EMULATOR_HOST = '127.0.0.1:8080';
const PROJECT_ID = 'loar-db';

// Steer firebase-admin to the emulator on every dynamic import. Must happen
// before the mock factory below runs (Vitest hoists vi.mock above module
// top-level statements, but env writes from the test setup file run earlier
// still — and these env vars are read inside the factory, not at hoist time).
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_PROJECT_ID = PROJECT_ID;

// Hoisted state — the mock factory is moved above this declaration, so the
// tracked-path set has to exist at hoist time. vi.hoisted gives us a stable
// reference shared between the factory and the afterEach cleanup hook.
const _state = vi.hoisted(() => ({
  paths: new Set<string>(),
}));

vi.mock('../lib/firebase', async () => {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }
  const rawDb = getFirestore();
  // Match production firebase.ts — `ignoreUndefinedProperties: true` lets
  // `set()` accept optional fields the writer didn't populate. Without this,
  // the test surface diverges from production and we'd false-positive on
  // writes that prod silently tolerates.
  try {
    rawDb.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() throws if called after the first read/write — safe to ignore
    // since a previous test in the same process already configured it.
  }

  /**
   * Wrap doc / collection refs so every write tracks the path. We don't tag
   * reads (no need) and the proxy is transparent for everything else — the
   * underlying firebase-admin code runs unchanged.
   */
  function wrapDoc(ref: FirebaseFirestore.DocumentReference): FirebaseFirestore.DocumentReference {
    return new Proxy(ref, {
      get(target, prop, receiver) {
        if (prop === 'set' || prop === 'create') {
          return async (...args: unknown[]) => {
            _state.paths.add(target.path);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (target as any)[prop](...args);
          };
        }
        if (prop === 'update') {
          return async (...args: unknown[]) => {
            _state.paths.add(target.path);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (target as any).update(...args);
          };
        }
        if (prop === 'collection') {
          return (subId: string) => wrapCollection(target.collection(subId));
        }
        const val = Reflect.get(target, prop, receiver);
        if (typeof val === 'function') return val.bind(target);
        return val;
      },
    });
  }

  function wrapCollection(
    ref: FirebaseFirestore.CollectionReference
  ): FirebaseFirestore.CollectionReference {
    return new Proxy(ref, {
      get(target, prop, receiver) {
        if (prop === 'doc') {
          return (id?: string) => {
            const docRef = id !== undefined ? target.doc(id) : target.doc();
            return wrapDoc(docRef);
          };
        }
        if (prop === 'add') {
          return async (data: Record<string, unknown>) => {
            const docRef = await target.add(data);
            _state.paths.add(docRef.path);
            return docRef;
          };
        }
        const val = Reflect.get(target, prop, receiver);
        if (typeof val === 'function') return val.bind(target);
        return val;
      },
    });
  }

  const db = new Proxy(rawDb, {
    get(target, prop, receiver) {
      if (prop === 'collection') {
        return (name: string) => wrapCollection(target.collection(name));
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === 'function') return val.bind(target);
      return val;
    },
  });

  return { db, firebaseAvailable: true, FieldValue };
});

beforeAll(async () => {
  // Sanity-check the emulator is actually reachable before tests run.
  try {
    const res = await fetch(`http://${EMULATOR_HOST}/`);
    if (!res.ok) throw new Error(`emulator HTTP ${res.status}`);
  } catch (e) {
    throw new Error(
      `Firestore emulator not reachable at ${EMULATOR_HOST}. Start it with:\n` +
        `  firebase emulators:start --only firestore --project ${PROJECT_ID}\n` +
        `Underlying error: ${(e as Error).message}`
    );
  }
});

afterEach(async () => {
  if (_state.paths.size === 0) return;
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore();
  await Promise.all(
    Array.from(_state.paths).map(async (p) => {
      try {
        await db.doc(p).delete();
      } catch {
        /* doc may have been deleted by the test itself; ignore */
      }
    })
  );
  _state.paths.clear();
});

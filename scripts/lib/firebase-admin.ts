/**
 * Shared Firebase Admin initialization for ops scripts.
 *
 * Mirrors the server's runtime resolution order
 * (`apps/server/src/lib/firebase.ts`) so an ops script picks up the same
 * credentials the running server uses, with sensible local-dev fallbacks.
 *
 * Resolution priority (first hit wins):
 *
 *   1. `--service-account=PATH`              explicit CLI override
 *   2. `FIREBASE_SERVICE_ACCOUNT`            inline JSON env (production canonical)
 *   3. `FIREBASE_SERVICE_ACCOUNT_PATH`       file path, resolved relative to repo root
 *   4. `GOOGLE_APPLICATION_CREDENTIALS`      Google Cloud ADC standard
 *   5. `firebase-service-account.json`       repo root convention
 *   6. `firebase-sa-key.json`                legacy convention used by older scripts
 *   7. applicationDefault()                  gcloud login / GCE metadata service
 *
 * On success, logs the project_id so ops can immediately see whether
 * they're hitting dev / staging / prod before any query fires.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  initializeApp,
  cert,
  getApps,
  applicationDefault,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export interface InitResult {
  db: Firestore;
  projectId: string | null;
  source: string;
}

const REPO_ROOT_GUESS = path.resolve(__dirname, '..', '..');

function resolveRelToRepoRoot(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(REPO_ROOT_GUESS, p);
}

interface Candidate {
  source: string;
  // Returns parsed SA object on success, null to skip, throws to halt with a clear error.
  load: () => ServiceAccount | null;
}

function buildCandidates(serviceAccountPathFlag: string | null): Candidate[] {
  const c: Candidate[] = [];

  if (serviceAccountPathFlag) {
    c.push({
      source: `--service-account=${serviceAccountPathFlag}`,
      load: () => {
        const abs = resolveRelToRepoRoot(serviceAccountPathFlag);
        if (!existsSync(abs)) {
          throw new Error(`--service-account file does not exist: ${abs}`);
        }
        return JSON.parse(readFileSync(abs, 'utf-8')) as ServiceAccount;
      },
    });
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    c.push({
      source: 'env FIREBASE_SERVICE_ACCOUNT (inline JSON)',
      load: () => {
        const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!) as Record<string, unknown>;
        // Placeholder check — the .env.example ships with literal "..." values.
        if (
          !parsed.project_id ||
          parsed.project_id === '...' ||
          !parsed.private_key ||
          parsed.private_key === '...'
        ) {
          return null;
        }
        return parsed as unknown as ServiceAccount;
      },
    });
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    c.push({
      source: `env FIREBASE_SERVICE_ACCOUNT_PATH=${process.env.FIREBASE_SERVICE_ACCOUNT_PATH}`,
      load: () => {
        const abs = resolveRelToRepoRoot(process.env.FIREBASE_SERVICE_ACCOUNT_PATH!);
        if (!existsSync(abs)) {
          throw new Error(`FIREBASE_SERVICE_ACCOUNT_PATH does not exist: ${abs}`);
        }
        return JSON.parse(readFileSync(abs, 'utf-8')) as ServiceAccount;
      },
    });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    c.push({
      source: `env GOOGLE_APPLICATION_CREDENTIALS=${process.env.GOOGLE_APPLICATION_CREDENTIALS}`,
      load: () => {
        const abs = resolveRelToRepoRoot(process.env.GOOGLE_APPLICATION_CREDENTIALS!);
        if (!existsSync(abs)) {
          throw new Error(`GOOGLE_APPLICATION_CREDENTIALS does not exist: ${abs}`);
        }
        return JSON.parse(readFileSync(abs, 'utf-8')) as ServiceAccount;
      },
    });
  }

  for (const conv of ['firebase-service-account.json', 'firebase-sa-key.json']) {
    const abs = path.resolve(REPO_ROOT_GUESS, conv);
    if (existsSync(abs)) {
      c.push({
        source: `convention ${conv}`,
        load: () => JSON.parse(readFileSync(abs, 'utf-8')) as ServiceAccount,
      });
    }
  }

  return c;
}

/**
 * Initialize Firebase Admin using the shared resolution order. Logs the
 * project_id so ops can confirm dev / staging / prod targeting before any
 * query lands.
 */
export function initFirebaseAdmin(serviceAccountPathFlag: string | null = null): InitResult {
  const existing = getApps()[0];
  if (existing) {
    const db = getFirestore(existing);
    const projectId = (existing.options as any)?.projectId ?? null;
    console.error(`[firebase-admin] reusing existing app (project=${projectId ?? 'unknown'})`);
    return { db, projectId, source: 'already-initialized' };
  }

  const candidates = buildCandidates(serviceAccountPathFlag);
  const errors: string[] = [];

  for (const cand of candidates) {
    try {
      const sa = cand.load();
      if (!sa) continue; // valid source, intentionally skipped (e.g. placeholder values)
      const app = initializeApp({ credential: cert(sa) });
      const db = getFirestore(app);
      db.settings({ preferRest: true });
      const projectId = (sa as any).project_id ?? null;
      console.error(
        `[firebase-admin] using ${cand.source}  →  project_id=${projectId ?? 'unknown'}`
      );
      return { db, projectId, source: cand.source };
    } catch (err) {
      errors.push(`  - ${cand.source}: ${(err as Error).message}`);
    }
  }

  // Last resort: ADC. Only useful when running on GCP or with `gcloud auth
  // application-default login` configured for the right project.
  try {
    const app = initializeApp({ credential: applicationDefault() });
    const db = getFirestore(app);
    console.error('[firebase-admin] using applicationDefault() (gcloud / GCE metadata)');
    return { db, projectId: null, source: 'applicationDefault' };
  } catch (err) {
    errors.push(`  - applicationDefault: ${(err as Error).message}`);
  }

  console.error('');
  console.error('[firebase-admin] No usable credentials. Tried:');
  for (const e of errors) console.error(e);
  console.error('');
  console.error('Set one of these (priority order, first wins):');
  console.error('  --service-account=/abs/path/to/key.json');
  console.error(
    "  export FIREBASE_SERVICE_ACCOUNT='<inline JSON>'                    # prod canonical"
  );
  console.error('  export FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-key.json            # dev');
  console.error('  export GOOGLE_APPLICATION_CREDENTIALS=./firebase-key.json           # ADC');
  console.error('  drop a firebase-service-account.json in the repo root');
  process.exit(2);
}

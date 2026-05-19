/**
 * Firebase credential diagnostic.
 *
 * Read-only. Inspects every credential source the ops scripts would try,
 * reports which would be picked, and pings Firestore once with a trivial
 * query to surface auth / project-config failures with actionable hints.
 *
 * Never echoes secrets — only metadata (project_id, client_email, source).
 *
 * Usage:
 *   pnpm ops:firebase-doctor
 *   pnpm ops:firebase-doctor --service-account=/path/to/key.json
 *   pnpm ops:firebase-doctor --skip-ping        # don't make any query
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { initFirebaseAdmin } from './lib/firebase-admin';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

interface CliArgs {
  serviceAccountPath: string | null;
  skipPing: boolean;
}

function parseArgs(): CliArgs {
  const args = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args.set(m[1], m[2] ?? 'true');
  }
  return {
    serviceAccountPath: args.get('service-account') ?? null,
    skipPing: args.get('skip-ping') === 'true',
  };
}

const REPO_ROOT = path.resolve(__dirname, '..');

interface Inspection {
  source: string;
  status: 'available' | 'missing' | 'invalid' | 'placeholder';
  projectId?: string;
  clientEmail?: string;
  notes?: string;
}

function inspectInlineEnv(): Inspection {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return { source: 'env FIREBASE_SERVICE_ACCOUNT', status: 'missing' };
  try {
    const parsed = JSON.parse(raw);
    if (parsed.project_id === '...' || parsed.private_key === '...') {
      return {
        source: 'env FIREBASE_SERVICE_ACCOUNT',
        status: 'placeholder',
        notes: '.env still has the example JSON with `...` values',
      };
    }
    return {
      source: 'env FIREBASE_SERVICE_ACCOUNT',
      status: 'available',
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
    };
  } catch (err) {
    return {
      source: 'env FIREBASE_SERVICE_ACCOUNT',
      status: 'invalid',
      notes: `JSON.parse failed: ${(err as Error).message}`,
    };
  }
}

function inspectFile(envName: string, rawPath: string | undefined): Inspection {
  if (!rawPath) return { source: `env ${envName}`, status: 'missing' };
  const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(REPO_ROOT, rawPath);
  if (!existsSync(abs)) {
    return {
      source: `env ${envName}=${rawPath}`,
      status: 'invalid',
      notes: `path does not exist (resolved to ${abs})`,
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf-8'));
    return {
      source: `env ${envName}=${rawPath}`,
      status: 'available',
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
    };
  } catch (err) {
    return {
      source: `env ${envName}=${rawPath}`,
      status: 'invalid',
      notes: `parse failed: ${(err as Error).message}`,
    };
  }
}

function inspectConventional(name: string): Inspection {
  const abs = path.resolve(REPO_ROOT, name);
  if (!existsSync(abs)) return { source: `convention ${name}`, status: 'missing' };
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf-8'));
    return {
      source: `convention ${name}`,
      status: 'available',
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
    };
  } catch (err) {
    return {
      source: `convention ${name}`,
      status: 'invalid',
      notes: `parse failed: ${(err as Error).message}`,
    };
  }
}

function statusBadge(s: Inspection['status']): string {
  switch (s) {
    case 'available':
      return '✓ usable';
    case 'placeholder':
      return '— placeholder values';
    case 'missing':
      return '— not set';
    case 'invalid':
      return '✗ invalid';
  }
}

function printInspections(rows: Inspection[]): void {
  console.log('');
  console.log('Firebase credential sources (resolution order — first usable wins):');
  console.log('─'.repeat(78));
  for (const r of rows) {
    console.log(`  ${r.source}`);
    console.log(`    ${statusBadge(r.status)}`);
    if (r.projectId) console.log(`    project_id  = ${r.projectId}`);
    if (r.clientEmail) console.log(`    client_email= ${r.clientEmail}`);
    if (r.notes) console.log(`    note: ${r.notes}`);
  }
  console.log('');
}

async function pingFirestore(serviceAccountPath: string | null): Promise<void> {
  console.log('Probing Firestore with a 1-doc query against `costAggregates`…');
  const { db, projectId, source } = initFirebaseAdmin(serviceAccountPath);
  try {
    const snap = await db.collection('costAggregates').limit(1).get();
    console.log('');
    console.log(`✓ Auth + Firestore API both work.`);
    console.log(`  source     = ${source}`);
    console.log(`  project_id = ${projectId ?? 'unknown'}`);
    console.log(`  sample     = ${snap.size} doc(s) found in costAggregates`);
    if (snap.size === 0) {
      console.log('');
      console.log("  (Empty result is normal if the cost-tracker hasn't logged anything yet");
      console.log('   in this project. Run a few API calls through the server to populate.)');
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.log('');
    console.log(`✗ Query failed against project_id=${projectId ?? 'unknown'}:`);
    console.log(`    ${msg}`);
    console.log('');
    if (msg.includes('PERMISSION_DENIED') || msg.includes('has not been used')) {
      console.log('Hint: Firestore API is disabled on this project. Enable at:');
      console.log(
        `  https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=${projectId ?? '<PROJECT>'}`
      );
    } else if (msg.includes('invalid authentication')) {
      console.log('Hint: the SA file is parseable but its credentials are rejected.');
      console.log('  Likely causes:');
      console.log('    • Key was rotated/revoked in the GCP console');
      console.log('    • SA was deleted, only the JSON file lingers');
      console.log('    • SA exists but lacks `roles/datastore.user` (or .viewer for read-only)');
      console.log('  Fix: in https://console.cloud.google.com/iam-admin/serviceaccounts');
      console.log('    1. Confirm the SA still exists (check client_email above)');
      console.log('    2. Grant Firestore role: gcloud projects add-iam-policy-binding');
      console.log(`       ${projectId ?? '<PROJECT>'} --member=serviceAccount:<email>`);
      console.log('       --role=roles/datastore.viewer');
      console.log('    3. Generate a fresh key and replace the JSON file');
    } else if (msg.includes('NOT_FOUND')) {
      console.log('Hint: Firestore database does not exist on this project.');
      console.log('  Run: gcloud firestore databases create --region=us-central1');
    }
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Static inspection — no network calls. Order matches lib/firebase-admin.ts.
  const inspections: Inspection[] = [];
  if (args.serviceAccountPath) {
    inspections.push(inspectFile('--service-account', args.serviceAccountPath));
  }
  inspections.push(inspectInlineEnv());
  inspections.push(
    inspectFile('FIREBASE_SERVICE_ACCOUNT_PATH', process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
  );
  inspections.push(
    inspectFile('GOOGLE_APPLICATION_CREDENTIALS', process.env.GOOGLE_APPLICATION_CREDENTIALS)
  );
  inspections.push(inspectConventional('firebase-service-account.json'));
  inspections.push(inspectConventional('firebase-sa-key.json'));
  printInspections(inspections);

  const firstUsable = inspections.find((i) => i.status === 'available');
  if (!firstUsable) {
    console.log('✗ No usable credentials found.');
    console.log('');
    console.log('Set one of these (priority order, first wins):');
    console.log("  • export FIREBASE_SERVICE_ACCOUNT='<inline JSON from GCP console>'");
    console.log('  • export FIREBASE_SERVICE_ACCOUNT_PATH=./your-key.json');
    console.log('  • drop firebase-service-account.json in the repo root');
    process.exit(2);
  }

  console.log(`→ Would use: ${firstUsable.source} (project_id=${firstUsable.projectId})`);
  if (args.skipPing) {
    console.log('(--skip-ping set, not querying Firestore)');
    return;
  }
  console.log('');
  await pingFirestore(args.serviceAccountPath);
}

main().catch((err) => {
  console.error('[firebase-doctor] unexpected error:', err);
  process.exit(2);
});

#!/usr/bin/env npx tsx
/**
 * Firestore Restore Script
 *
 * Restores Firestore from a GCS backup created by firestore-backup.ts.
 *
 * Usage:
 *   npx tsx apps/server/src/scripts/firestore-restore.ts \
 *     --backup gs://loar-firestore-backups/backups/2026-04-17T00-00-00-000Z \
 *     --confirm
 *
 * Arguments:
 *   --backup <uri>   Full GCS URI of the backup to restore (required)
 *   --confirm        Safety flag — restore will not proceed without this
 *
 * Required env:
 *   FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH
 *
 * IAM requirements (same as backup):
 *   - Cloud Datastore Import Export Admin
 *   - Storage Admin (on the backup bucket)
 *
 * WARNING: Importing overwrites existing documents with the same IDs.
 * Documents that exist in the live database but not in the backup are NOT deleted.
 * This is a merge, not a full wipe-and-replace.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../../../../');

config({ path: resolve(rootDir, '.env') });

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
  [key: string]: unknown;
}

function loadServiceAccount(): ServiceAccount {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!parsed.project_id || parsed.project_id === '...') {
      throw new Error('FIREBASE_SERVICE_ACCOUNT contains placeholder values');
    }
    return parsed;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const absPath = resolve(rootDir, process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    return JSON.parse(readFileSync(absPath, 'utf-8'));
  }

  throw new Error(
    'Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH.'
  );
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const { SignJWT, importPKCS8 } = await import('jose');

  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, 'RS256');

  const jwt = await new SignJWT({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope:
      'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore',
    iat: now,
    exp: now + 3600,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function parseArgs(): { backup: string; confirm: boolean } {
  const args = process.argv.slice(2);
  let backup = '';
  let confirm = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--backup' && args[i + 1]) {
      backup = args[++i];
    } else if (args[i] === '--confirm') {
      confirm = true;
    }
  }

  return { backup, confirm };
}

async function main() {
  const { backup, confirm } = parseArgs();

  if (!backup) {
    console.error('Error: --backup <gs://...> is required.');
    console.error('');
    console.error('Usage:');
    console.error(
      '  npx tsx apps/server/src/scripts/firestore-restore.ts --backup gs://bucket/path --confirm'
    );
    process.exit(1);
  }

  if (!backup.startsWith('gs://')) {
    console.error('Error: --backup must be a GCS URI starting with gs://');
    process.exit(1);
  }

  if (!confirm) {
    console.error('');
    console.error('  *** RESTORE SAFETY CHECK ***');
    console.error('');
    console.error('  This will import documents from:');
    console.error(`    ${backup}`);
    console.error('');
    console.error('  Existing documents with matching IDs will be OVERWRITTEN.');
    console.error('  This operation cannot be undone.');
    console.error('');
    console.error('  To proceed, re-run with the --confirm flag.');
    console.error('');
    process.exit(1);
  }

  const sa = loadServiceAccount();
  const projectId = sa.project_id;

  console.log(`[firestore-restore] Starting Firestore import`);
  console.log(`  Project: ${projectId}`);
  console.log(`  Source:  ${backup}`);
  console.log(`  Started: ${new Date().toISOString()}`);

  const accessToken = await getAccessToken(sa);

  // https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases/importDocuments
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):importDocuments`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputUriPrefix: backup,
      // Empty collectionIds = import ALL collections from the backup
      collectionIds: [],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[firestore-restore] Import request failed (${res.status}):`);
    console.error(text);
    process.exit(1);
  }

  const operation = (await res.json()) as { name: string };
  console.log(`[firestore-restore] Import operation started: ${operation.name}`);

  // Poll until complete
  console.log(`[firestore-restore] Waiting for import to complete...`);
  const opUrl = `https://firestore.googleapis.com/v1/${operation.name}`;
  let done = false;
  let attempts = 0;
  const maxAttempts = 120;

  while (!done && attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 5000));
    attempts++;

    const pollRes = await fetch(opUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!pollRes.ok) {
      console.warn(`[firestore-restore] Poll failed (${pollRes.status}), retrying...`);
      continue;
    }

    const opStatus = (await pollRes.json()) as {
      done?: boolean;
      error?: { code: number; message: string };
    };

    if (opStatus.error) {
      console.error(`[firestore-restore] Import failed:`, opStatus.error);
      process.exit(1);
    }

    if (opStatus.done) {
      done = true;
      console.log(`[firestore-restore] Import completed successfully`);
    }
  }

  if (!done) {
    console.warn(`[firestore-restore] Import still running after ${maxAttempts * 5}s.`);
    console.warn(`  Operation: ${operation.name}`);
    console.warn(`  Check status in the Firebase/GCP console.`);
    process.exit(2);
  }

  console.log(`  Finished: ${new Date().toISOString()}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[firestore-restore] Fatal error:', err);
  process.exit(1);
});

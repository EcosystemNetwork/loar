#!/usr/bin/env npx tsx
/**
 * Firestore Backup Script
 *
 * Exports all Firestore collections to a GCS bucket using the
 * Firestore Admin exportDocuments API.
 *
 * Usage:
 *   npx tsx apps/server/src/scripts/firestore-backup.ts
 *
 * Required env:
 *   FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH
 *   FIRESTORE_BACKUP_BUCKET  — GCS bucket name (e.g. "loar-firestore-backups")
 *
 * Optional env:
 *   FIRESTORE_BACKUP_PREFIX  — path prefix inside the bucket (default: "backups")
 *
 * The script calls the Firestore REST exportDocuments endpoint.
 * The service account needs the following IAM roles:
 *   - Cloud Datastore Import Export Admin
 *   - Storage Admin (on the target bucket)
 * The default Firestore service agent also needs Storage Admin on the bucket.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../../../../');

// Load env from monorepo root
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

/**
 * Create a signed JWT and exchange it for a Google access token.
 * We do this manually to avoid importing the full google-auth-library.
 */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  // Dynamic import — jose is already a server dependency
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

async function main() {
  const bucket = process.env.FIRESTORE_BACKUP_BUCKET;
  if (!bucket) {
    console.error('Error: FIRESTORE_BACKUP_BUCKET env var is required.');
    console.error('Set it to a GCS bucket name, e.g. "loar-firestore-backups".');
    process.exit(1);
  }

  const prefix = process.env.FIRESTORE_BACKUP_PREFIX || 'backups';
  const sa = loadServiceAccount();
  const projectId = sa.project_id;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputUri = `gs://${bucket}/${prefix}/${timestamp}`;

  console.log(`[firestore-backup] Starting Firestore export`);
  console.log(`  Project:     ${projectId}`);
  console.log(`  Destination: ${outputUri}`);
  console.log(`  Started at:  ${new Date().toISOString()}`);

  const accessToken = await getAccessToken(sa);

  // https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases/exportDocuments
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      outputUriPrefix: outputUri,
      // Empty collectionIds = export ALL collections
      collectionIds: [],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[firestore-backup] Export request failed (${res.status}):`);
    console.error(text);
    process.exit(1);
  }

  const operation = (await res.json()) as { name: string; metadata?: Record<string, unknown> };
  console.log(`[firestore-backup] Export operation started: ${operation.name}`);

  // Poll the operation until it completes
  console.log(`[firestore-backup] Waiting for export to complete...`);
  const opUrl = `https://firestore.googleapis.com/v1/${operation.name}`;
  let done = false;
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes at 5s intervals

  while (!done && attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 5000));
    attempts++;

    const pollRes = await fetch(opUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!pollRes.ok) {
      console.warn(`[firestore-backup] Poll failed (${pollRes.status}), retrying...`);
      continue;
    }

    const opStatus = (await pollRes.json()) as {
      done?: boolean;
      error?: { code: number; message: string };
      response?: { outputUriPrefix: string };
    };

    if (opStatus.error) {
      console.error(`[firestore-backup] Export failed:`, opStatus.error);
      process.exit(1);
    }

    if (opStatus.done) {
      done = true;
      console.log(`[firestore-backup] Export completed successfully`);
      console.log(`  Output:      ${opStatus.response?.outputUriPrefix || outputUri}`);
    }
  }

  if (!done) {
    console.warn(`[firestore-backup] Export still running after ${maxAttempts * 5}s.`);
    console.warn(`  Operation: ${operation.name}`);
    console.warn(`  Check status in the Firebase/GCP console.`);
    process.exit(2);
  }

  console.log(`  Finished at: ${new Date().toISOString()}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[firestore-backup] Fatal error:', err);
  process.exit(1);
});

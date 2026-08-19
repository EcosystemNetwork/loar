#!/usr/bin/env npx tsx
/**
 * Backup Cron
 *
 * Long-running scheduler for Firestore exports. Runs the backup immediately
 * on startup, then every BACKUP_INTERVAL_MS (default 24h).
 *
 * Usage:
 *   node apps/server/dist/scripts/backup-cron.js
 *
 * Required env:
 *   FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH
 *   FIRESTORE_BACKUP_BUCKET
 *
 * Optional env:
 *   BACKUP_INTERVAL_MS — milliseconds between exports (default 86400000)
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../../../../');

config({ path: resolve(rootDir, '.env') });

const INTERVAL_MS = Math.max(60000, parseInt(process.env.BACKUP_INTERVAL_MS || '86400000', 10));
const BACKUP_PATH = resolve(__dirname, './firestore-backup.js');

let running = false;

function runBackup() {
  if (running) {
    console.log(`[backup-cron] Skipping run because another backup is already in progress`);
    return;
  }
  running = true;

  const now = new Date().toISOString();
  console.log(`[backup-cron] Starting scheduled backup at ${now}`);

  const child = spawn('node', [BACKUP_PATH], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    console.error('[backup-cron] Failed to spawn backup:', err);
    running = false;
  });

  child.on('close', (code) => {
    const finishedAt = new Date();
    console.log(
      `[backup-cron] Backup finished with exit code ${code} at ${finishedAt.toISOString()}`
    );
    if (code === 0) writeFileSync('/tmp/backup-last-success', String(finishedAt.getTime()));
    running = false;
  });
}

runBackup();
setInterval(runBackup, INTERVAL_MS);

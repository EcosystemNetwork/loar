#!/usr/bin/env npx tsx
/**
 * Worker liveness probe.
 *
 * Inspects /proc for a running generation.worker process. This works inside the
 * production worker container without requiring ps/pgrep or a network listener.
 *
 * Usage:
 *   node apps/server/dist/scripts/worker-healthcheck.js
 *
 * Exit 0 if the worker is present, 1 otherwise.
 */

import { readdirSync, readFileSync } from 'fs';

const WORKER_MARKER = 'dist/workers/generation.worker.js';

function isWorkerAlive(): boolean {
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf-8').replace(/\0/g, ' ');
      if (cmdline.includes(WORKER_MARKER)) {
        return true;
      }
    } catch {
      // Process exited while reading — skip.
    }
  }
  return false;
}

if (!isWorkerAlive()) {
  console.error('[worker-healthcheck] generation.worker process not found');
  process.exit(1);
}

console.log('[worker-healthcheck] generation.worker is alive');
process.exit(0);

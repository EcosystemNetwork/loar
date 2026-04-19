/**
 * tRPC read-heavy scenario.
 *
 * Simulates a logged-out visitor browsing the gallery, reading content
 * metadata, and checking the moderation status of a few items. This is the
 * dominant traffic pattern we care about for p95 SLO: anonymous reads.
 *
 * Routes exercised (all public procedures):
 *   - moderation.getContentStatus
 *   - gallery.list  (if available — falls back to batch health probe)
 *
 * Tune `CONTENT_IDS` to real content IDs in the target environment. Leaving
 * the placeholder values forces NOT_FOUND paths which still exercise Firestore
 * and auth-mw, so the numbers are meaningful.
 *
 * Run:
 *   LOAR_SERVER_URL=https://staging.loar.fun k6 run scripts/loadtest/trpc-read-heavy.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.LOAR_SERVER_URL || 'http://localhost:3000';

// Placeholder content IDs — replace with real ones from the target env
const CONTENT_IDS = (__ENV.LOAD_CONTENT_IDS || 'sample_1,sample_2,sample_3').split(',');

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '3m', target: 200 },
        { duration: '30s', target: 500 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:status}': ['p(95)<300'],
    'http_req_duration{endpoint:health}': ['p(99)<150'],
    http_req_failed: ['rate<0.005'],
    checks: ['rate>0.99'],
  },
};

function getStatus(contentId) {
  // Public tRPC v10 GET shape:
  //   /trpc/moderation.getContentStatus?input=%7B%22contentId%22%3A%22xxx%22%7D
  const input = encodeURIComponent(JSON.stringify({ contentId }));
  return http.get(`${BASE}/trpc/moderation.getContentStatus?input=${input}`, {
    tags: { endpoint: 'status' },
  });
}

function getHealth() {
  return http.get(`${BASE}/health`, { tags: { endpoint: 'health' } });
}

export default function () {
  // Typical mix: 5 status reads + 1 health probe per virtual-user iteration.
  for (const id of CONTENT_IDS) {
    const res = getStatus(id);
    check(res, {
      'status read 2xx': (r) => r.status >= 200 && r.status < 300,
    });
  }

  const h = getHealth();
  check(h, {
    'health 200': (r) => r.status === 200,
  });

  sleep(0.5);
}

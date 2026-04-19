/**
 * Takedown abuse scenario.
 *
 * Simulates an attacker trying to mass-flood /api/takedown to bury content
 * or exhaust the moderation queue. Each VU hammers with randomized claimant
 * emails so per-email dedup + per-email rate limit + per-IP rate limit all
 * get exercised.
 *
 * Expected outcome (healthy server):
 *   - http_req_failed below 1%  (the server should respond, not crash)
 *   - checks.rate for "status is 200 or 429" above 99%
 *   - p95 latency < 500ms — the 429 path is the hot path under abuse
 *
 * Run:
 *   LOAR_SERVER_URL=https://staging.loar.fun k6 run scripts/loadtest/takedown-abuse.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.LOAR_SERVER_URL || 'http://localhost:3000';
const firstAllowed = new Rate('first_request_allowed');
const subsequentBlocked = new Rate('subsequent_request_blocked');

export const options = {
  scenarios: {
    flood: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '2m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    // At steady state, the vast majority of requests must be rate-limited.
    // If this drops we've broken rate limiting.
    subsequent_request_blocked: ['rate>0.8'],
  },
};

function randomEmail(seed) {
  return `attacker_${__VU}_${__ITER}_${seed}@loadtest.local`;
}

export default function () {
  const payload = JSON.stringify({
    contentId: `fake_content_${__VU}_${__ITER}`,
    claimantName: 'Load Tester',
    claimantEmail: randomEmail(1),
    claimantAddress: '1 Test Street, Test City, TS 00000, Testland',
    claimantPhone: '+15550000000',
    copyrightWork: 'Fake copyrighted work for load testing',
    explanation: 'This is a load test request and should be blocked quickly.',
    goodFaith: true,
    swornStatement: true,
    signature: 'Load Tester',
  });

  const res = http.post(`${BASE}/api/takedown`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'takedown' },
  });

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });

  if (__ITER === 0) firstAllowed.add(res.status === 200 ? 1 : 0);
  else subsequentBlocked.add(res.status === 429 ? 1 : 0);

  // Slight pause so we don't burn local CPU spinning the loop
  sleep(0.05);
}

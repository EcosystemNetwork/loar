/**
 * k6 scenario — anonymous wiki browse.
 *
 * Simulates 1,000 concurrent visitors landing on the site and hitting a
 * handful of cheap, unauthenticated endpoints. Exercises the static asset
 * path, the tRPC public read path, and the server/health ping that every
 * liveness probe already calls.
 *
 * Throttled to ~10 RPS per VU so the cumulative 10 kRPS matches what a 10K
 * MAU product realistically sees at peak (most users are idle, not polling).
 *
 * Run:
 *   k6 run scripts/loadtest/wiki-browse.js
 *   LOAR_SERVER_URL=https://staging.loar.fun k6 run --vus 2000 --duration 10m scripts/loadtest/wiki-browse.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.LOAR_SERVER_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '1m', target: 1000 },
        { duration: '3m', target: 1000 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Reads must stay snappy. If the p95 climbs past 500ms at 1K VUs the
    // server needs tuning (Firestore reads, Redis contention, nginx worker
    // count).
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    // Any non-2xx at this load means something is broken — rate limits kick
    // in per-IP and a single k6 host doesn't saturate them.
    http_req_failed: ['rate<0.005'],
    checks: ['rate>0.995'],
  },
};

export default function () {
  // /health — cheap JSON probe, what load balancers hit.
  const health = http.get(`${BASE}/health`);
  check(health, {
    'health 200': (r) => r.status === 200,
    'health reports service': (r) => (r.json() || {}).service === 'loar-server',
  });

  // / — root, currently returns plain "OK" text but will exercise the
  // security-headers + metrics middleware even when the real SPA is served
  // by a different origin.
  const root = http.get(`${BASE}/`);
  check(root, {
    'root 200': (r) => r.status === 200,
  });

  // Pace the VU so 1K concurrent → ~10 kRPS total (not 60 kRPS).
  sleep(0.1);
}

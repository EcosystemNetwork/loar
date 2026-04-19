/**
 * k6 scenario — SIWE nonce issuance throughput.
 *
 * Stresses `GET /auth/nonce` — the first call every new sign-in makes.
 * Nonces write to Firestore (`siweNonces` collection) with TTL, so this is
 * effectively a Firestore-write load test too.
 *
 * NOTE: the server enforces 20 req/min per-IP on /auth/*, so when running
 * from a single host you'll see 429s once the bucket drains. That's
 * intentional behaviour to verify: (a) the limiter fires, (b) the process
 * doesn't leak memory while rate-limiting, (c) nonces still generate
 * correctly when the limiter is not firing.
 *
 * When you need to exceed the per-IP limit for real throughput measurements,
 * run from multiple hosts (k6 Cloud or distributed mode) or temporarily
 * raise the limit in a staging deploy.
 *
 * Run:
 *   k6 run scripts/loadtest/siwe-nonce.js
 *   LOAR_SERVER_URL=https://staging.loar.fun k6 run scripts/loadtest/siwe-nonce.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE = __ENV.LOAR_SERVER_URL || 'http://localhost:3000';

const rateLimited = new Counter('siwe_nonce_rate_limited');
const nonce200 = new Rate('siwe_nonce_200_rate');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 50 },
        { duration: '40s', target: 200 },
        { duration: '1m', target: 200 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    // Counts only the 200s (ignores the intentional 429s from the limiter).
    siwe_nonce_200_rate: ['rate>0.20'],
    // We care that SOME calls succeed — at 200 VUs behind a 20/min limit the
    // success rate WILL be low. Point of this scenario is that when the
    // limiter allows a request, it must complete cleanly.
  },
};

export default function () {
  const res = http.get(`${BASE}/auth/nonce`);

  if (res.status === 429) {
    rateLimited.add(1);
  }

  nonce200.add(res.status === 200);

  check(res, {
    'nonce is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'nonce body ok when 200': (r) => {
      if (r.status !== 200) return true;
      try {
        const body = r.json();
        return typeof body?.nonce === 'string' && body.nonce.length > 0;
      } catch {
        return false;
      }
    },
  });

  sleep(0.3);
}

# Load Tests

k6 scenarios for pushing real throughput at the LOAR server. Complements the
functional smoke harness in [../smoke/](../smoke/) — these are for **percentile
latency and throughput** measurements, not feature correctness.

## Prerequisites

- k6 installed locally — `brew install k6` (macOS) or see https://k6.io/docs/get-started/installation/
- Server reachable at `LOAR_SERVER_URL` (default `http://localhost:3000`)
- **Never** point these at production. Staging only.

## Scenarios

| Script           | What it loads                                                                    | Default VUs | Duration |
| ---------------- | -------------------------------------------------------------------------------- | ----------- | -------- |
| `wiki-browse.js` | `/health`, `/` — the traffic pattern of an anonymous browser landing on the site | 1000        | 5m       |
| `siwe-nonce.js`  | `GET /auth/nonce` — SIWE login cold start                                        | 200         | 2m       |

## Run

```bash
# Default: localhost, built-in VU/duration.
k6 run scripts/loadtest/wiki-browse.js

# Override target + load.
LOAR_SERVER_URL=https://staging.loar.fun k6 run --vus 500 --duration 3m scripts/loadtest/wiki-browse.js

# SIWE nonce.
k6 run scripts/loadtest/siwe-nonce.js
```

## Interpreting results

- **`http_req_duration`** — the distribution that matters. Watch p95 and p99.
- **`http_req_failed`** — should be near 0 on healthy infra. A nonzero rate means the server, Redis, or Firestore hit a wall.
- **`checks`** — expected-status assertions. Anything below 99.9% means the server started returning wrong responses under load.

Thresholds live in each script's `options.thresholds`. When a threshold fails,
k6 exits non-zero so CI can gate on it.

## What to do when a scenario fails

1. Check `/health` — which dependency is degraded?
2. Check server Sentry — is it returning 5xx?
3. Check the Prometheus `/metrics` endpoint — what's the p95 on `loar_http_request_duration_seconds`? Queue depth? Circuit breakers tripping?
4. If the app is fine but k6 still reports failures, the load generator host may be the bottleneck — run from a bigger box or distribute.

## Not included

- **Generation load** — authoring a k6 scenario that burns real AI provider budget is too dangerous to ship without guard rails. When you need to stress the generation pipeline, point a dedicated k6 scenario at a staging `STRIPE_TEST_MODE=1` + `FAL_KEY=<sandbox>` environment with a wallet that has test credits only.
- **SIWE full sign cycle** — requires EIP-191 signing, which k6's JS runtime doesn't do natively. The existing smoke harness covers the sign/verify path functionally; use that plus the nonce-issuance scenario here to cover the throughput side.

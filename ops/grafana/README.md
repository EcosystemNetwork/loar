# Grafana — LOAR Dashboards

Dashboard-as-code for the Phase 0.4 boards described in [docs/scale-readiness-10k.md](../../docs/scale-readiness-10k.md). Import the JSON into any Grafana instance; point the `DS_PROM` datasource variable at a Prometheus that scrapes the server's `/metrics` endpoint.

## Prerequisites

- Grafana Cloud (free tier works) or self-hosted Grafana ≥ 10.
- A Prometheus scrape job targeting `https://api.loar.fun/metrics` (or wherever the server is deployed). If `METRICS_AUTH_TOKEN` is set on the server, add the bearer token to the scrape config:
  ```yaml
  scrape_configs:
    - job_name: loar-server
      metrics_path: /metrics
      scrape_interval: 30s
      authorization:
        type: Bearer
        credentials: <METRICS_AUTH_TOKEN>
      static_configs:
        - targets: [api.loar.fun]
  ```

## Import

1. Grafana UI → **Dashboards** → **New** → **Import**.
2. Upload [`dashboards/loar-platform.json`](./dashboards/loar-platform.json) or paste its contents.
3. When prompted, select the Prometheus datasource you configured above.
4. Save.

## What's on each board

### Board 1 — Traffic + Latency

- **RPS by route** — how much traffic each endpoint serves.
- **p95 / p99 latency by route** — the number to watch during load tests. Thresholds: yellow at 500ms, red at 2s.
- **Error rate** — % of 5xx and 4xx responses. Yellow at 1%, red at 5%.
- **Auth success rate** — SIWE flow health. Red below 95%.
- **Uptime** — seconds since the server process last started.

### Board 2 — AI Spend + Generation

- **AI generations / minute** by provider + status — watch for the spend hockey-stick.
- **AI generation p95 duration by kind** — detects provider slowdowns before they drain the queue.
- **Credits spent (24h)** — rough proxy for AI $ spend. Multiply by your per-credit provider cost for a dollar number.
- **Credit refund rate** — refunds as a share of spend+refund. Rising means generation jobs are failing after billing.
- **Storage fallback rate** — uploads that hit a fallback provider. Rising means the primary is degraded.

### Board 3 — Queue + Provider Health

- **Generation queue depth** — waiting / active / delayed / failed from `loar_queue_depth`. Thresholds: yellow at 100, red at 500.
- **Circuit breakers** — one tile per provider, colour-coded closed / half-open / open.
- **Process memory / CPU** — RSS bytes and CPU core-seconds.

## Alert recommendations

Not included in the dashboard JSON (alerts live in Grafana contact points, easier managed separately), but the scale-readiness plan exit gate calls for:

- `sum(rate(loar_http_requests_total{status=~"5xx"}[5m])) / sum(rate(loar_http_requests_total[5m])) > 0.05` — 5% error rate
- `histogram_quantile(0.95, sum by (le) (rate(loar_http_request_duration_seconds_bucket[5m]))) > 2` — p95 latency above 2s
- `loar_queue_depth{state="waiting"} > 500` — queue backing up (see [docs/incident-response.md § Generation queue backing up](../../docs/incident-response.md))
- `loar_circuit_breaker_state > 0` — any provider in half-open/open state
- `sum(increase(loar_credits_transactions_total{kind="spend",status="success"}[1h])) > $THRESHOLD` — runaway spend

Route each of the above to `#ops` Slack, and page on-call when the error rate exceeds 10% for more than 5 minutes.

## Refreshing metrics

New counters / gauges exported from [apps/server/src/lib/metrics.ts](../../apps/server/src/lib/metrics.ts) automatically appear in Prometheus after the next scrape. Update this dashboard JSON when you add panels — keep it in git so ops can re-import after a cluster rebuild.

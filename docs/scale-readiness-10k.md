# 10K-User Readiness Plan

**Created**: 2026-04-18
**Scope**: What's required to safely support up to 10,000 concurrent/active users on LOAR.

This document is a **scale-readiness** plan. It does not repeat content already tracked in:

- [docs/audit-fix-tracker.md](./audit-fix-tracker.md) — contract/security findings (93/117 fixed)
- [docs/pre-launch-checklist.md](./pre-launch-checklist.md) — Phase 1/2 launch checklist
- [docs/disaster-recovery.md](./disaster-recovery.md) — DR runbook

It identifies **only the gaps those docs don't cover** and sequences them alongside the remaining blockers.

---

## Current State (honest assessment)

### What we have

- Contract fixes: 93 of 117 findings resolved; only operational handoff + external audit remain ([tracker](./audit-fix-tracker.md))
- Server-side rate limiting: 100/min IP, 20/min auth, 10/min uploads, **10/min per-wallet AI + 200/day ceiling** ([rate-limit.ts:181-260](../apps/server/src/middleware/rate-limit.ts#L181-L260))
- Firestore: 51 composite indexes ([firestore.indexes.json](../firestore.indexes.json)) + deny-all default rules ([firestore.rules](../firestore.rules))
- Circuit breakers per provider (FAL, Bytedance, ElevenLabs, Meshy, Pinata, Lighthouse, RPC) ([circuit-breaker.ts](../apps/server/src/lib/circuit-breaker.ts))
- Health endpoint exposes queue metrics + breaker state ([apps/server/src/index.ts](../apps/server/src/index.ts))
- Smoke harness: 7 layers, CI-integrated ([scripts/smoke/](../scripts/smoke/))
- Docker + docker-compose.prod.yml + SSH-deploy workflow ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml))
- Moderation queue live ([PRD 10](./prd-moderation-rights-ops.md))
- Disaster recovery runbook ([docs/disaster-recovery.md](./disaster-recovery.md))
- Sentry SDK installed on server (DSN-conditional) ([apps/server/src/lib/sentry.ts](../apps/server/src/lib/sentry.ts))
- **Phase 0 additions (2026-04-18)**: web Sentry ([apps/web/src/lib/sentry.ts](../apps/web/src/lib/sentry.ts)), Prometheus `/metrics` endpoint + HTTP middleware ([apps/server/src/lib/metrics.ts](../apps/server/src/lib/metrics.ts), [apps/server/src/middleware/metrics.ts](../apps/server/src/middleware/metrics.ts)), pino structured logger ([apps/server/src/lib/logger.ts](../apps/server/src/lib/logger.ts)), mobile Sentry scaffold ([apps/mobile/src/lib/sentry.ts](../apps/mobile/src/lib/sentry.ts), side-effect imported from [apps/mobile/app/\_layout.tsx](../apps/mobile/app/_layout.tsx)).

### Remaining scale-specific gaps

- **Mobile native crashes still invisible** — JS-layer Sentry is live on `apps/mobile`, but native iOS/Android crash capture requires `expo prebuild` + a native rebuild so `@sentry/react-native` can link its SDK
- **APM dashboards shipped as code, not yet provisioned** — [ops/grafana/dashboards/loar-platform.json](../ops/grafana/dashboards/loar-platform.json) is ready to import; ops needs to point a Prometheus instance at `/metrics` and import the JSON
- **No bundle analyzer** — 558KB MetaMask + 1.8MB wagmi chunks flagged in memory still untracked
- **No load tests** — smoke = happy path only; no k6/artillery throughput or percentile data
- **No monthly/weekly spend cap per user** — only a 200/day rate limit; one bad actor can hit 6K generations/month
- **No anomaly/abuse detection** — no alarms on error-rate spikes, RPS cliffs, or credit-drain patterns
- **No feature kill switches in server code** — circuit breakers catch _provider_ failures, not _product_ failures (e.g., "pause new universe mints")
- **No incident playbooks beyond DR** — no SEV definitions, no paging rotation, no public status page
- **INFRA-02 open** — SIWE_JWT_SECRET not yet in a managed secret store with rotation
- **Broad console.log migration to pino** — logger exists; migrating existing call sites is a follow-up pass

---

## Phased Plan

Each phase has an **exit gate** — don't advance without meeting it. Durations assume one backend + one frontend engineer working in parallel; adjust for actual staffing.

### Phase 0 — Close the observability hole (Week 1)

Why first: you can't manage 10K users on a system where you can't see what's happening. Everything downstream benefits from this being in place.

| #   | Task                                                                                                                                     | Owner  | Status                                                                              | Files                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | `@sentry/react` on `apps/web`, init in `main.tsx` with release tag + session replay (10% sample in prod, 100% on errors)                 | FE     | DONE                                                                                | [apps/web/src/lib/sentry.ts](../apps/web/src/lib/sentry.ts), [apps/web/src/main.tsx](../apps/web/src/main.tsx)                                                                                                  |
| 0.2 | `@sentry/react-native` on `apps/mobile`, init in `app/_layout.tsx`                                                                       | Mobile | DONE (JS-layer scaffold; native capture needs `expo prebuild` + native rebuild)     | [apps/mobile/src/lib/sentry.ts](../apps/mobile/src/lib/sentry.ts), [apps/mobile/app/\_layout.tsx](../apps/mobile/app/_layout.tsx)                                                                               |
| 0.3 | Prometheus `/metrics` endpoint with HTTP + AI + storage + credits counters, live queue/breaker gauges, optional `METRICS_AUTH_TOKEN`     | BE     | DONE                                                                                | [apps/server/src/lib/metrics.ts](../apps/server/src/lib/metrics.ts), [apps/server/src/middleware/metrics.ts](../apps/server/src/middleware/metrics.ts), [apps/server/src/index.ts](../apps/server/src/index.ts) |
| 0.4 | Grafana Cloud (free tier) or Datadog trial; Board 1 RPS + p95 latency, Board 2 AI $ spend, Board 3 Firestore reads + breaker state       | DevOps | DONE (dashboard-as-code shipped; ops needs to import + configure Prometheus scrape) | [ops/grafana/dashboards/loar-platform.json](../ops/grafana/dashboards/loar-platform.json), [ops/grafana/README.md](../ops/grafana/README.md)                                                                    |
| 0.5 | Wire `SENTRY_DSN` / `VITE_SENTRY_DSN` / `LOG_LEVEL` / `METRICS_AUTH_TOKEN` into `.env.example` + [docs/environment.md](./environment.md) | DevOps | DONE                                                                                | —                                                                                                                                                                                                               |
| 0.6 | Structured logging via pino; JSON to stdout in prod, pretty-print in dev; redact secret fields                                           | BE     | DONE (module) / follow-up needed to migrate existing `console.log` call sites       | [apps/server/src/lib/logger.ts](../apps/server/src/lib/logger.ts)                                                                                                                                               |

**Exit gate**: front-end errors appear in Sentry; a Grafana board shows server p95 latency and today's AI spend; paging on `api_error_rate > 5%` fires a test alert to Slack/PagerDuty.

---

### Phase 1 — Spend, abuse, and kill-switch controls (Weeks 2–3)

Why second: even a 100-user private beta can torch your AI budget if one account loops `generateFromScript`. The daily 200-gen cap is not tight enough once real $LOAR/credit dynamics are live.

| #   | Task                                                                                                                                                                                                         | Owner | Files                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------- |
| 1.1 | **Monthly spend cap** per wallet (default $50 / 2000 credits), configurable via `platformConfig` doc                                                                                                         | BE    | [apps/server/src/routers/credits/](../apps/server/src/routers/credits/), `apps/server/src/middleware/rate-limit.ts` |
| 1.2 | **Pre-charge balance check** on every generation route (currently debits optimistically then refunds on failure — [generation.worker.ts:140-159](../apps/server/src/workers/generation.worker.ts#L140-L159)) | BE    | generation routes                                                                                                   |
| 1.3 | **Anomaly detection job** (Cloud Scheduler → HTTP): flag any wallet with >3σ generations vs rolling 7-day mean; write to `flags` with `kind: 'abuse'`                                                        | BE    | `apps/server/src/jobs/abuse-detect.ts` (new)                                                                        |
| 1.4 | **Feature kill switches** in `platformConfig`: `mintingEnabled`, `generationEnabled`, `purchaseEnabled`, `registrationEnabled`. Wire `assertFeatureEnabled()` into write routes                              | BE    | [apps/server/src/routers/admin/admin.routes.ts](../apps/server/src/routers/admin/admin.routes.ts)                   |
| 1.5 | Admin UI panel at `/admin/ops` exposing toggle for each kill switch + live spend/user count from metrics                                                                                                     | FE    | `apps/web/src/routes/admin/ops.tsx` (new)                                                                           |
| 1.6 | Email/Slack alert when kill switch flips (audit trail already written via `platformConfigAudit`)                                                                                                             | BE    | notification handler                                                                                                |

**Exit gate**: one engineer can, within 60 seconds, flip `generationEnabled=false` from the admin panel and verify no new jobs enter the queue. A test account running generations in a loop gets flagged within one job run (≤15 min).

---

### Phase 2 — Load test and tune (Weeks 3–4, parallel with Phase 1)

| #   | Task                                                                                                                                                                                    | Owner  | Files                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| 2.1 | Author [k6](https://k6.io) scenarios: (a) 1K concurrent wiki browsers, (b) 500 concurrent AI generation queue, (c) 200 concurrent SIWE auths. Target: p95 < 500ms read, < 2s tRPC write | BE     | `scripts/loadtest/` (new)                             |
| 2.2 | Run against staging; identify top 3 slow queries via Firestore usage dashboard; add missing composite indexes to [firestore.indexes.json](../firestore.indexes.json)                    | BE     | —                                                     |
| 2.3 | Add `rollup-plugin-visualizer` to [apps/web/vite.config.ts](../apps/web/vite.config.ts); commit baseline bundle report; set CI threshold: fail if main chunk > 1.5MB gzipped            | FE     | vite.config.ts                                        |
| 2.4 | Code-split the wallet/wagmi chunks per route (they only need to load on `/create`, `/universe/*`, `/mint` — not on marketing pages)                                                     | FE     | [apps/web/src/router.tsx](../apps/web/src/router.tsx) |
| 2.5 | Verify Redis is not the bottleneck — rate-limit uses Redis; at 10K users peak is ~500 RPS; ensure Redis is not on a single small instance                                               | DevOps | docker-compose.prod.yml                               |

**Exit gate**: k6 run sustains 1K virtual users for 5 min with p95 < 500ms on read paths and zero 5xx. Web landing page LCP < 2.5s on mid-tier mobile (Moto G).

---

### Phase 3 — Contract governance handoff (Weeks 4–6)

Directly from the tracker's "Remaining Mainnet Blockers." Not scale-specific but the hard gate before any user funds.

| #   | Task                                                                                                                | Tracker ID      | Files                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| 3.1 | Deploy Gnosis Safe (3/5) on Base; collect signer keys in hardware wallets                                           | GOV-01          | —                                                                                                   |
| 3.2 | Deploy OZ `TimelockController` (48h delay); wire Safe as PROPOSER + EXECUTOR                                        | GOV-01          | [apps/contracts/script/TransferToMultisig.s.sol](../apps/contracts/script/TransferToMultisig.s.sol) |
| 3.3 | Run `TransferToMultisig.s.sol` dry-run → review → mainnet; verify `owner()` on every UUPS + beacon returns Timelock | GOV-01          | —                                                                                                   |
| 3.4 | Rotate `SIWE_JWT_SECRET` into Doppler/Infisical/GCP Secret Manager; add 90-day rotation calendar reminder           | INFRA-02        | [apps/server/src/lib/siwe.ts](../apps/server/src/lib/siwe.ts)                                       |
| 3.5 | Deploy a dedicated community-treasury address; call `UniverseTokenDeployerV3.setCommunityRecipient(addr)`           | TOKEN-04 config | —                                                                                                   |

**Exit gate**: no contract is owned by the deployer EOA; Safe UI shows pending timelock operations; rotation runbook committed to [docs/](./).

---

### Phase 4 — Legal & compliance (Weeks 5–7, parallel with Phase 3)

| #   | Task                                                                                                                               | Tracker ID    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 4.1 | Engage counsel to review existing `/terms` + `/privacy` (both substantive, dated 2026-04-10 per pre-launch-checklist.md §#19)      | LEGAL-01      |
| 4.2 | Register DMCA agent with US Copyright Office ($6); add designated-agent contact to `/dmca`                                         | LEGAL-02      |
| 4.3 | Implement 10–14 day counter-notice + putback flow for 512(g) safe harbor                                                           | pre-launch #4 |
| 4.4 | Ticker decision: rename `$LOAR` or accept NYSE:LOAR C&D risk — get counsel opinion in writing                                      | LEGAL-03      |
| 4.5 | Update tokenomics docs to remove "deflationary burns" language; plan `LoarBurner` → `PremiumActions` rename in post-launch upgrade | BURN-01       |

**Exit gate**: counsel sign-off email on file; DMCA agent record public; ticker decision documented.

---

### Phase 5 — External audit (Weeks 6–12)

| #   | Task                                                                                                                                                        | Tracker ID |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 5.1 | Engage 2 firms (Spearbit, Cantina, Trail of Bits, ChainSecurity) on current snapshot                                                                        | Pass 1     |
| 5.2 | Fix findings from Pass 1                                                                                                                                    | —          |
| 5.3 | Re-audit after Pass 1 fixes — larger surface changes (NFT upgradeable, revenue routing, RIGHTS signature path, UNIVERSE restrictions) warrant a second look | Pass 2     |
| 5.4 | Launch Code4rena or Sherlock contest (2-week window, $50-100K prize pool)                                                                                   | —          |
| 5.5 | Stand up Immunefi bug bounty ($5K–$250K tiered)                                                                                                             | —          |

**Exit gate**: both Pass 1 + Pass 2 reports delivered, all Critical/High findings resolved or formally accepted, contest concluded, bounty live.

---

### Phase 6 — Incident response maturity (Weeks 7–8, parallel)

| #   | Task                                                                                                                                                         | Notes                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| 6.1 | Author SEV definitions (SEV1: funds at risk; SEV2: degraded UX; SEV3: minor bug)                                                                             | `docs/incident-response.md` (new)   |
| 6.2 | On-call rotation in PagerDuty / OpsGenie — minimum 2 engineers, weekly rotation                                                                              | —                                   |
| 6.3 | Public status page (statuspage.io free tier, or a static page reading from the `/health` endpoint)                                                           | —                                   |
| 6.4 | Tabletop exercise: "a Safe signer key is compromised." Walk through: pause affected contracts via Timelock, rotate Safe owner, public comms, Sentry timeline | —                                   |
| 6.5 | Smoke test extension: cover admin endpoints, refund flow, contentAuditLog write path                                                                         | [scripts/smoke/](../scripts/smoke/) |

**Exit gate**: one tabletop exercise completed; on-call schedule published; status page linked from footer.

---

### Phase 7 — Scale verification @ 10K (Weeks 8–9)

| #   | Task                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | Invite-only beta: 500 → 2000 → 5000 → 10000 users in staged waves; hold at each tier for 72h monitoring window                              |
| 7.2 | Watch Grafana for: Firestore reads (stay under free-tier headroom), Redis memory, worker queue depth, circuit breakers firing, p95 creeping |
| 7.3 | Gate each wave on: zero SEV1 in the preceding 72h, p95 < target, breaker opens ≤ 3, spend per active user within 20% of forecast            |
| 7.4 | Post-mortem doc on every wave — what broke, what scaled, what needs tuning                                                                  |

**Exit gate**: 10K active users, 7-day rolling window with zero SEV1, p95 within target, cost per active user within business-model forecast ([project_model_routing.md](../../../.claude/projects/-home-god-Desktop-LOAR-loar/memory/project_model_routing.md)).

---

## Timeline Summary

```
Week:  1   2   3   4   5   6   7   8   9   10  11  12
────────────────────────────────────────────────────────
P0:   ███
P1:       ████████
P2:            ████████
P3:                 ████████████
P4:                     ████████████
P5:                          ████████████████████████
P6:                              ████████
P7:                                       ████████
```

- **Testnet beta @ 10K (no real money)**: end of Week 4 — P0, P1, P2 done; P3 in progress.
- **Mainnet soft launch @ 10K (real money)**: end of Week 12 — all phases complete including external audit Pass 2.

---

## Decision Points

These are **not** implementation choices — they are product / business calls that block advancement.

1. **Beta vs mainnet scope for "10K users"** — do we need 10K on mainnet (Phase 5 required, ~12 weeks) or 10K on testnet beta (Phase 4 complete, ~4 weeks)?
2. **Audit budget** — 2-firm pass + contest + bounty is realistically $80-150K. If budget is tighter, do 1 firm + contest, accept higher residual risk.
3. **NYSE:LOAR ticker** — rename is disruptive (marketing, contract redeploy consideration, memory already notes [project_launch_audit_2026_04_16.md]). C&D risk is real but historically enforcement has been slow for unrelated Web3 tickers. Need counsel view.
4. **Observability spend** — Datadog for the full stack at 10K users is ~$500-1500/mo. Grafana Cloud free tier covers most of it. Decision: eat the vendor cost or self-host Prometheus + Loki.

---

## Horizontal Scaling Playbook

Production uses [`docker-compose.prod.yml`](../docker-compose.prod.yml) with nginx load-balancing across `N` server replicas and `M` worker replicas, all sharing one Redis for rate limits + BullMQ. Replica counts are env-driven: set `SERVER_REPLICAS` and `WORKER_REPLICAS` in `.env`, the deploy workflow passes them as `docker compose up --scale`.

### Sizing math

**Server replicas** — each Node/Hono instance handles ~500 RPS sustained on a 1-vCPU / 2GB box before p95 degrades. nginx round-robins.

| Active users (peak concurrent) | Server replicas | Memory / CPU total |
| ------------------------------ | --------------- | ------------------ |
| < 500                          | 1               | 2GB / 1 vCPU       |
| 500 – 2,000                    | 2               | 4GB / 2 vCPU       |
| 2,000 – 5,000                  | 3               | 6GB / 3 vCPU       |
| 5,000 – 10,000                 | 4–6             | 8–12GB / 4–6 vCPU  |

**Worker replicas** — total concurrent AI jobs = `WORKER_REPLICAS × WORKER_CONCURRENCY`. Each job pegs ~1 CPU during video encode/upload. Keep the product ≤ `vCPUs - 1` per host so the scheduler has headroom.

| Expected concurrent generations | Config (replicas × concurrency) | Throughput @ 2-min avg job |
| ------------------------------- | ------------------------------- | -------------------------- |
| ≤ 5                             | 1 × 5                           | ~150 jobs/hour             |
| ≤ 10                            | 2 × 5 (default)                 | ~300 jobs/hour             |
| ≤ 25                            | 5 × 5                           | ~750 jobs/hour             |
| ≤ 50                            | 10 × 5                          | ~1,500 jobs/hour           |

**10K users, 5% active, 10% of active queue a generation** → ~50 concurrent generations at peak. Plan for `WORKER_REPLICAS=10 WORKER_CONCURRENCY=5` minimum, which also assumes AI providers (FAL, Seedance, ElevenLabs) accept your sustained QPS. If they rate-limit, workers idle — bottleneck moves upstream.

### Scaling commands

```bash
# Scale up before a traffic spike (no downtime)
SERVER_REPLICAS=6 WORKER_REPLICAS=10 \
  docker compose -f docker-compose.prod.yml up -d \
  --scale server=$SERVER_REPLICAS --scale worker=$WORKER_REPLICAS

# Scale workers only (server untouched)
docker compose -f docker-compose.prod.yml up -d --scale worker=10 --no-recreate

# Drain workers (e.g. during a kill-switch incident so queued jobs don't clear)
docker compose -f docker-compose.prod.yml up -d --scale worker=0

# One-off: check current replica counts
docker compose -f docker-compose.prod.yml ps --format table
```

### Known ceilings we can't fix with more replicas

- **Firestore reads/sec** — quota is per-project, not per-replica. At 10K users hitting the wiki/gallery, expect ~5–10K reads/sec peak. Free tier is 50K reads/day → you'll burn it in minutes. Blaze plan covers 10K. A rogue unbounded listener on the server can blow this up — watch the Firestore usage dashboard.
- **Redis memory** — rate-limit keys + BullMQ queue state. 256MB handles 10K users. Bump to 1GB if you see `maxmemory` evictions in the Redis logs.
- **AI provider QPS** — each provider's per-key limit. Scaling workers past the provider's limit just makes them wait in line. Shard keys across regions or tiers if you hit this.
- **Pinata / Lighthouse upload rate** — measured, circuit-breaker-protected; the StorageManager falls over between providers. At 10K users uploading generated content, verify both provider plans are on paid tiers.

### Expected behaviour under overload

- Rate limit (`rateLimiter` middleware) returns 429 **before** any of the above ceilings trip. User sees "too many requests".
- Generation queue backs up — new jobs wait in BullMQ. The BullMQ admission gate (`MAX_QUEUED_GENERATIONS=200` in `.env.example`) rejects new jobs with a user-visible "platform is busy" error rather than letting the queue grow unbounded.
- Worker failures → circuit breakers open → client sees "provider unavailable", StorageManager falls over, job ends up in failed state and refund is issued.

All three of these are already coded. The scaling knobs above only matter until you hit the first of those ceilings; after that, scaling workers further makes no difference until the ceiling is raised.

---

## What this plan deliberately excludes

- **Horizontal scaling beyond 10K** — Firestore, Hono on Fly/Railway, and Redis handle 10K comfortably. Past 50K we'd need read replicas, pub/sub, and probably a managed Postgres for hot-path reads. Not in scope.
- **Internationalization / regional deploys** — single US region is fine for 10K.
- **Feature work** — this plan doesn't add product; it hardens what exists. Feature PRDs are in [docs/](./).

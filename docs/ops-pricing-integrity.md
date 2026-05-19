# Pricing Integrity — Ops Runbook

LOAR's pricing-integrity stack ([docs/pricing.md](pricing.md)) detects four
classes of drift between what the model registries claim, what we actually
log, and what providers actually bill. This runbook covers the production
operational concerns: credentials, secrets, IAM roles, schedules, and what
to do when each alert fires.

## TL;DR

| Need to …                       | Run                                                      |
| ------------------------------- | -------------------------------------------------------- |
| Check that ops credentials work | `pnpm ops:firebase-doctor`                               |
| Run a one-off drift audit       | `pnpm cost:check-drift`                                  |
| Spot-check registry freshness   | `pnpm registry:check-staleness`                          |
| Reconcile last month's spend    | `pnpm reconcile:spend --invoice=./invoices/YYYY-MM.json` |
| Regenerate the pricing doc      | `pnpm docs:pricing`                                      |

All four ops scripts share credential resolution via
[`scripts/lib/firebase-admin.ts`](../scripts/lib/firebase-admin.ts). They
target the same Firestore project the server runtime uses.

## Credentials

### Resolution order (first hit wins)

1. `--service-account=PATH` CLI flag
2. `FIREBASE_SERVICE_ACCOUNT` env var (inline JSON) — **canonical for prod**
3. `FIREBASE_SERVICE_ACCOUNT_PATH` env var (path, resolved relative to repo root)
4. `GOOGLE_APPLICATION_CREDENTIALS` env var (GCP ADC standard)
5. `firebase-service-account.json` in repo root
6. `firebase-sa-key.json` in repo root (legacy)
7. `applicationDefault()` — `gcloud auth application-default login`

If you see auth errors but the doctor reports a "usable" source, the SA
file is parseable but its credentials are rejected at the GCP layer (key
rotated or SA missing the right role). See "When auth fails" below.

### Recommended setup for production ops

Production deploys (Railway / Vercel / etc.) already inject
`FIREBASE_SERVICE_ACCOUNT` as a secret to the server runtime. For the ops
scripts (which run on a workstation or in CI), the cleanest pattern is a
**separate, read-only service account** so a rotated runtime key doesn't
break local ops work and vice versa.

```bash
# One-time setup — create an ops-only SA in your Firebase project
gcloud iam service-accounts create loar-ops-readonly \
  --display-name="LOAR pricing-integrity ops" \
  --project=loar-db

# Grant Firestore read access (and nothing else)
gcloud projects add-iam-policy-binding loar-db \
  --member="serviceAccount:loar-ops-readonly@loar-db.iam.gserviceaccount.com" \
  --role="roles/datastore.viewer"

# Generate a key file
gcloud iam service-accounts keys create ./firebase-ops-readonly.json \
  --iam-account="loar-ops-readonly@loar-db.iam.gserviceaccount.com"

# Either put the file in repo root + add to .gitignore,
# or set FIREBASE_SERVICE_ACCOUNT_PATH to point at it.
```

Then in CI, store the file contents in the
`FIREBASE_SERVICE_ACCOUNT_JSON` GitHub Actions secret — the
[`cost-drift.yml`](../.github/workflows/cost-drift.yml) workflow already
writes it to `firebase-service-account.json` and invokes
`pnpm ops:firebase-doctor` to fail fast if the key is bad.

## When auth fails

`pnpm ops:firebase-doctor` will name the exact failure mode. The three
common ones:

### 1. "Request had invalid authentication credentials"

SA file is parseable but GCP rejects the credentials. Almost always means
the **key was rotated** in the console (or the SA was deleted).

Fix:

```bash
# Confirm the SA still exists (read client_email from the JSON)
gcloud iam service-accounts describe \
  "$(jq -r .client_email firebase-service-account.json)" \
  --project=loar-db

# If it does, generate a fresh key
gcloud iam service-accounts keys create ./firebase-service-account.json \
  --iam-account="$(jq -r .client_email firebase-service-account.json)"

# If it doesn't, recreate via the "Recommended setup" block above.
```

### 2. "Cloud Firestore API has not been used in project … or is disabled"

The Firestore API has never been enabled on this project. This happens
when you point at a project that was created for something else
(e.g. `agent-guild` from another integration).

Fix: either point at the right project, or enable Firestore:

```bash
gcloud services enable firestore.googleapis.com --project=<RIGHT_PROJECT>
```

### 3. "Database does not exist"

Project is right and API is enabled, but no Firestore database has been
created yet.

Fix:

```bash
gcloud firestore databases create --region=us-central1 --project=loar-db
```

## Workflow schedules

| Workflow          | File                                                                  | Cadence                  | Triggers issue when                                                |
| ----------------- | --------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| Cost drift        | [`cost-drift.yml`](../.github/workflows/cost-drift.yml)               | Daily 13:00 UTC          | Any model's $/1k-tok (or $/call) drifts >5% (3% for bytedance/zai) |
| Pricing staleness | [`pricing-staleness.yml`](../.github/workflows/pricing-staleness.yml) | Weekly Mondays 14:00 UTC | Any registry untouched >90 days                                    |
| CI doc gate       | [`ci.yml`](../.github/workflows/ci.yml) (`quality` job)               | Every PR                 | Registry change not accompanied by `pnpm docs:pricing`             |

Cost drift and pricing staleness both **open / update / close a single
GitHub issue** per workflow rather than spamming a new one each run. When
all checks pass again the issue auto-closes.

## When each alert fires — playbook

### Cost-drift issue opened

A model's realized $/1k-tok or $/call shifted beyond threshold week-over-week.

**Triage order**:

1. **Is it the provider's fault?** Open the provider's pricing page (links
   in the issue body) and compare the model's current price against the
   registry. If they differ, provider changed list pricing.
2. **Patch the registry** — update `providerInputUsdPerMtok` / `providerOutputUsdPerMtok` (or `providerCostUsd` for per-call providers).
3. **Regenerate** — `pnpm docs:pricing && git add docs/pricing.md`.
4. **Commit** with a message that bumps the registry file's mtime so the
   staleness check resets the 90-day clock too.

If the price didn't move at the provider, the alert is likely a behavior
shift (a model rev produces more output tokens per call). $/1k-tok would
stay stable but $/call would rise — confirm in the issue body's table.
No registry change needed in that case; the metric normalizes once usage
mix stabilizes.

### Staleness issue opened

A registry file hasn't been touched in 90+ days. Provider list prices may
have moved without us noticing — needs human re-verification.

**Process**:

1. Open each provider dashboard listed in the issue.
2. For each model in the stale registry, confirm the registry's
   `provider*Usd*` field matches the current list price.
3. Patch any drift and commit. Even if no number changes, the commit bumps
   the file's mtime → staleness clock resets → issue auto-closes on the
   next Monday run.

Budget: roughly 1 hour per registry the first time, ~15 min on re-checks.

### Reconcile drift (manual, post-billing-cycle)

Run after each calendar month closes and provider invoices are available:

```bash
# 1. Pull each provider's invoice total from their dashboard for the month
cp scripts/invoice-template.json invoices/2026-04.json
# Fill in the real per-provider invoice totals

# 2. Reconcile against the cost-tracker ledger
pnpm reconcile:spend --invoice=./invoices/2026-04.json
```

The script flags any provider whose registry-derived total diverges from
the actual bill by both >3% AND >$100 (absolute). If a provider trips
both, the registry rate for one of its models is wrong — find which by
grouping the ledger by model for that provider:

```bash
# (Future enhancement — currently you eyeball it from the costAggregates
# documents using the admin dashboard.)
```

## Threshold tuning

Defaults baked into the scripts (set after first round of production
observations):

| Knob                                   | Default                 | Override                                                              |
| -------------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| Cost-drift threshold (global)          | 5%                      | `pnpm cost:check-drift --threshold=0.07`                              |
| Cost-drift threshold (per-provider)    | bytedance=3%, zai=3%    | `pnpm cost:check-drift --provider-thresholds=openai=0.07,gemini=0.07` |
| Cost-drift min calls ($/1k-tok metric) | 100                     | `pnpm cost:check-drift --min-calls=50`                                |
| Cost-drift min calls ($/call metric)   | 50                      | (same `--min-calls` flag overrides both)                              |
| Cost-drift window                      | 7d trailing vs 7d prior | `--window=14 --baseline=14`                                           |
| Staleness threshold                    | 90 days                 | `pnpm registry:check-staleness --days=60`                             |
| Reconcile % tolerance                  | 3%                      | `pnpm reconcile:spend --tolerance=0.05`                               |
| Reconcile min absolute drift           | $100                    | `pnpm reconcile:spend --min-drift-usd=50`                             |

The asymmetric provider thresholds (3% for the volatile providers, 5% for
the stable ones) reflect the difference in how often ByteDance / Z.AI
move pricing vs OpenAI / Google / Anthropic. Tighten / loosen per
operational experience.

## Default-model flip cache-invalidation gotcha

`apps/server/src/services/vlm/extractor.ts` defaults to `gemini-2.5-flash`
(was `gemini-2.5-pro`). The extractor's deterministic cache key includes
the model — so on first prod deploy after the flip, **every prior
extraction is a cache miss** and the Flash model will re-extract every
asset it processes. Expect:

- A brief duplicate-work spike for ~24h after deploy as the new cache fills
- Visibly different extraction quality for any heavy-grade scenes the old
  Pro model handled (`recap.ts` similarly defaults to Flash; impact is
  lower because recap output is marketing copy, not canonical metadata)
- A net cost drop of ~16× on the affected calls

If the quality degradation is unacceptable on day 1, force the old default
back via env until the team re-tunes prompts for Flash:

```bash
# In server runtime env (Railway / Vercel / local .env):
VLM_EXTRACT_MODEL=gemini-2.5-pro
VLM_RECAP_MODEL=gemini-2.5-pro
```

The env override bypasses both the registry default AND the cache-miss
storm (existing cached entries match the Pro key). Plan a deliberate
cutover (announce in #ops, monitor `[llm-router]` logs + the
`cost-drift.yml` workflow for the first 7 days post-flip) before removing
the override.

## Secret rotation runbook

When the ops SA key needs to rotate (annual cycle, suspected exposure,
team rollover):

```bash
# 1. Generate a fresh key
gcloud iam service-accounts keys create ./firebase-service-account.json.new \
  --iam-account="loar-ops-readonly@loar-db.iam.gserviceaccount.com"

# 2. Replace the local file (and update FIREBASE_SERVICE_ACCOUNT_JSON
#    secret in the GitHub repo settings)
mv firebase-service-account.json.new firebase-service-account.json

# 3. Confirm
pnpm ops:firebase-doctor

# 4. List old keys
gcloud iam service-accounts keys list \
  --iam-account="loar-ops-readonly@loar-db.iam.gserviceaccount.com"

# 5. Delete the old key by its ID (returned from the list above)
gcloud iam service-accounts keys delete <OLD_KEY_ID> \
  --iam-account="loar-ops-readonly@loar-db.iam.gserviceaccount.com"
```

The runtime SA used by the server is separate — rotate it through the
server-deploy runbook, not this one.

## What this stack does NOT cover

- **Per-user billing fairness** — the credit model handles that, not the
  ledger. If a user disputes their charge, look at `aiAgentCredits` /
  `costLedger` joined by `userId`, not at this audit suite.
- **Real-time alerting** — these workflows run daily at the most. For
  sub-hour alerting, hook the `loar_provider_cost_usd_total` Prometheus
  counter into your alerting system.
- **Scraping provider pricing pages** — intentionally not built. See the
  rationale in [pricing.md](pricing.md#keeping-these-numbers-honest).

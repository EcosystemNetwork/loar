# Incident Response Runbook

**Audience**: on-call engineers and admins at LOAR.
**Scope**: operational response to production issues. Contract/on-chain incidents require extra steps — see [docs/governance-transition.md](./governance-transition.md) for Safe + Timelock procedures.

---

## Severity Levels

| SEV      | Definition                                                                                                                                                             | Response time                     | Who's paged                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------- |
| **SEV1** | Funds at risk, user data exposed, or platform completely down. Examples: runaway AI spend, compromised admin key, production Firestore wiped, on-chain funds draining. | Immediate — page within 5 minutes | Primary on-call + backup + incident commander |
| **SEV2** | Major feature broken or degraded for a significant share of users. Examples: generation queue stuck, auth returning 500s, storage provider down with no fallback.      | 15 min response                   | Primary on-call                               |
| **SEV3** | Minor bug, single-user impact, or cosmetic regression. Examples: one route 404, admin UI rendering glitch.                                                             | Handle in normal hours            | File an issue                                 |

When in doubt, escalate up. Downgrading later is free; missing a SEV1 is not.

---

## First 5 Minutes

Run this in order, for any SEV1 or SEV2:

1. **Open the situation room** — Slack thread in `#ops`, link to anything you look at so the next person can pick up. Start an incident doc: time, symptom, affected surface.
2. **Check the dashboards** — Grafana (scrapes `/metrics`): RPS, p95, error rate per route, AI spend rate, queue depth, circuit-breaker state. Sentry: new issue spike on server + web.
3. **Check the health endpoint** — `curl https://api.loar.fun/health`. Reveals Firestore availability, Redis health, queue depth, and which circuit breakers are open.
4. **Decide: mitigate or investigate first?** — if users are bleeding money/data, mitigate immediately (see kill-switch playbook below) and investigate after. Otherwise gather evidence so the fix doesn't mask the root cause.

---

## Kill-Switch Playbook

Location: [`/admin/ops`](../apps/web/src/routes/admin/ops.tsx). Requires a wallet in `VITE_ADMIN_ADDRESSES`.

| Symptom                                                                     | Flip off                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| AI spend is hockey-sticking; provider bill is going to hurt                 | `generationEnabled`                                                     |
| Stripe/ETH/LOAR purchase flow is misbehaving (double-charges, wrong totals) | `purchaseEnabled`                                                       |
| On-chain mint writing bad data or failing halfway through a multi-step flow | `mintingEnabled`                                                        |
| Automated account creation is running wild (signup abuse)                   | `registrationEnabled`                                                   |
| Spend cap itself is the problem (legit big-client partner being throttled)  | `monthlySpendCapEnabled` — then raise the cap or add a bypass allowlist |

**What the flip does**: writes `platformConfig/fees`, audited to `platformConfigAudit` with your UID and timestamp. Clients feel the change within ~60s (the in-process config cache TTL). Kill switches emit a Slack alert so the rest of the team sees it without you DMing. Nothing destructive — the switch is reversible by flipping it back.

**What the flip does NOT do**: stop in-flight jobs. A generation that's already in the BullMQ queue at the moment of the flip will complete. If you need to drain in-flight jobs, use the separate procedure: scale the worker service to zero replicas (`docker compose up --scale worker=0` or the equivalent for your host).

---

## Common Scenarios

### Billing runaway / AI spend hockey-sticks

**Signal**: `loar_ai_generation_total` on Grafana, or the provider dashboard, shows a sharp climb. Abuse detector may have produced an `abuseFlags` row and Slack ping.

1. Flip `generationEnabled=false` in `/admin/ops`. ← Stops the bleed.
2. Open the Abuse Flags panel on the same page. Find the offending wallet(s).
3. If a single wallet is responsible: confirm the flag, then decide — dismiss if legit (update the cap), ban if abuse (take the address out of `VITE_ADMIN_ADDRESSES` / `ADMIN_ADDRESSES` isn't relevant; for a user ban, add them to an allowlist-check in `auth.ts` or simply drop their session via `revokeToken`).
4. If it's distributed abuse: raise `monthlySpendCapCredits` to a tighter value before re-enabling, or temporarily lower the rate-limit thresholds in [`apps/server/src/middleware/rate-limit.ts`](../apps/server/src/middleware/rate-limit.ts).
5. Re-enable `generationEnabled`. Watch the dashboard for 15 minutes before logging the incident closed.

### Abuse-detector flag in Slack

**Signal**: `#ops` Slack: "Abuse detector: wallet flagged".

1. Open `/admin/ops` → Abuse Flags → filter `open`.
2. Find the row by the flag id in the Slack message. Review: is this a known partner? Do they have a pattern of cap-adjacent behaviour or is this a cliff?
3. **Confirm** only if you've verified abuse — that's the audit trail. **Dismiss** when it's expected. Either way the row stops pinging (6h cooldown already applied).
4. If you confirm an attacker: rotate any keys they might have touched (storage bucket signing keys, Stripe payment intents, etc.) and add a follow-up Linear task for pattern hardening.

### Kill-switch flipped by someone else

**Signal**: `#ops` Slack: "Kill switch flipped OFF".

1. If you flipped it, move on.
2. If you didn't, ping the signer (`Changed by <uid>` in the alert). Worst case there's a compromised admin key — if you can't reach the signer in 10 minutes, assume compromise and rotate `ADMIN_ADDRESSES` server-side to a fresh Safe-governed wallet.

### Storage provider down

**Signal**: `/health` shows `pinata` or `lighthouse` circuit breaker in `open` state. Gallery uploads failing with 503.

1. The StorageManager should fail over to the next provider by priority — check `loar_storage_upload_total{status="fallback"}` on Grafana; if it's non-zero, the system is handling it.
2. If ALL providers are open: file a SEV2, page storage team. Temporary mitigation: flip `generationEnabled=false` so new content can't pile up waiting for upload.

### Firestore read failures on spend-cap check

**Signal**: Server logs show read errors out of `services/spend-cap.ts`; users report "Monthly spend cap reached" errors when they haven't hit it.

Note: the spend-cap path is fail-closed — a Firestore outage surfaces as a user-visible 500. This is intentional so an outage doesn't silently disable billing protection.

1. Confirm outage via Firebase Status Page and `/health`.
2. Short-term mitigation: flip `monthlySpendCapEnabled=false` in `/admin/ops`. This lets spends proceed without the cap. Re-enable the moment Firestore recovers.
3. Watch `loar_credits_transactions_total` — if the counter is still incrementing, the deduction itself is working.

### Auth 500s (SIWE nonce issuance failing)

**Signal**: Sentry spike on `/auth/nonce` or `/auth/verify`. Users can't sign in.

1. `/health` → check `redis` (nonces use it) and `firebase`.
2. If Redis is down but Firestore is up, [`apps/server/src/lib/siwe.ts`](../apps/server/src/lib/siwe.ts) already falls back to Firestore for nonce persistence. Nonce issuance should still work, just slower.
3. If Firestore is down too: users can't sign in, period. File SEV1. No clean mitigation — new sign-ins will fail until it's back.

### On-chain write regressions (mint failures)

**Signal**: Sentry `ContractExecutionReverted` spikes on specific routes. Users report "transaction failed" on `/create`.

1. Identify the failing contract via the revert reason in Sentry.
2. Check the contract audit tracker ([docs/audit-fix-tracker.md](./audit-fix-tracker.md)) — is there a known issue? Is a Safe-timelock proposal in flight that's changed behaviour?
3. Flip `mintingEnabled=false` while investigating.
4. If the contract itself needs pausing (bigger than a config flip), see [docs/governance-transition.md](./governance-transition.md) — requires Safe signers + Timelock proposal.

### Indexer lag

**Signal**: User sees content in UI that doesn't appear in the indexer view. `/health` on the indexer shows lag seconds.

1. Check RPC provider status. If the primary is down, `PONDER_RPC_FALLBACKS` should have kicked in — verify via indexer logs.
2. If lag is < 60 blocks, usually self-corrects. Communicate "indexer catching up" in the #status Slack and wait.
3. If lag is > 1000 blocks or growing: file SEV2, may need a reindex from a checkpoint.

---

## Tools Reference

| Tool                        | What it's for                                       | URL                                                                                   |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Grafana (or equivalent APM) | p95 latency, RPS, error rate, AI spend, queue depth | Internal — see `docs/environment.md`                                                  |
| Sentry web                  | JavaScript errors, session replay on errors         | `sentry.io/org/loar/`                                                                 |
| Sentry server               | Server exceptions, unhandled rejections             | Same org                                                                              |
| `/health`                   | Liveness + dependency status                        | `https://api.loar.fun/health`                                                         |
| `/metrics`                  | Prometheus scrape target                            | `https://api.loar.fun/metrics` (bearer-token protected when `METRICS_AUTH_TOKEN` set) |
| `/admin/ops`                | Feature kill switches, spend cap, abuse flags       | `https://loar.fun/admin/ops`                                                          |
| `/admin/moderation`         | Content flags, DMCA takedowns, audit log            | `https://loar.fun/admin/moderation`                                                   |
| `platformConfigAudit`       | Who changed what config and when                    | Firestore → server-only; query via admin tRPC                                         |
| Safe (multisig)             | Contract ownership + timelock execution             | `app.safe.global` — see [governance-transition.md](./governance-transition.md)        |

---

## After an Incident

Every SEV1 and SEV2 gets a post-mortem within 72 hours. Template:

```markdown
# Incident — <date> — <one-line summary>

**Severity**: SEV1/2/3
**Start**: <first evidence>
**End**: <fully mitigated>
**Duration**: <minutes>

## What happened

<user-visible impact, in plain words>

## Timeline

- HH:MM — first alert fired
- HH:MM — on-call acknowledged
- HH:MM — mitigation applied (link to admin/ops audit row)
- HH:MM — root cause identified
- HH:MM — permanent fix deployed

## Root cause

<technical explanation; link to code + commit>

## Why this wasn't caught earlier

<honestly — missing monitor, untested path, assumption that broke>

## Action items

- [ ] <specific fix or monitor> — owner, due date
```

Post-mortems live under `docs/postmortems/<YYYY-MM-DD>-<slug>.md`. Blameless; the point is to harden the system, not to assign fault.

---

## On-Call Rotation

TBD — rotation schedule lives in PagerDuty/OpsGenie once it's set up. For now, the primary admin address in `ADMIN_ADDRESSES` is the de-facto on-call. Before inviting public users at scale, formalise this: minimum two engineers, weekly rotation, documented escalation path.

---

## Related

- [docs/scale-readiness-10k.md](./scale-readiness-10k.md) — the broader plan this runbook is part of (Phase 6).
- [docs/disaster-recovery.md](./disaster-recovery.md) — data-loss / Firestore-wipe scenarios.
- [docs/governance-transition.md](./governance-transition.md) — contract-pause procedures via Safe + Timelock.
- [docs/audit-fix-tracker.md](./audit-fix-tracker.md) — known contract issues and their mitigations.

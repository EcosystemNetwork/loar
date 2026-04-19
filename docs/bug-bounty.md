# LOAR Bug Bounty Program

> **Status**: Draft — ready to paste into Immunefi / HackerOne / self-hosted page once the
> treasury allocation is approved.
>
> **Last updated**: 2026-04-19
>
> **Owner**: security@loar.fun

This document is the canonical program spec. Public copy lives on the website + the
security platform listing; update both in the same PR as this file.

---

## Scope

### In-scope assets

| Asset           | Surface                                         | Branch / Tag                                        |
| --------------- | ----------------------------------------------- | --------------------------------------------------- |
| Smart contracts | `apps/contracts/src/**` on Base (when deployed) | Latest deployed commit — see `deployments/base/`    |
| Smart contracts | `apps/contracts/src/**` on Base Sepolia         | Testnet findings count if they reproduce on mainnet |
| Server          | `apps/server/**` production deploy              | `main`                                              |
| Web client      | `apps/web/**` production deploy                 | `main`                                              |
| Indexer         | `apps/indexer/**` production deploy             | `main`                                              |
| Mobile          | `apps/mobile/**` released builds                | Version in App Store / Play listing                 |

### Out of scope

- Testnet-only bugs that do not reproduce on mainnet
- Third-party dependencies (report upstream; link us the upstream issue)
- Findings requiring physical access to a victim's device
- Social engineering against LOAR employees or users
- Spam, DoS requiring sustained ≥10 Gbps, or application-layer DoS that only exhausts
  a single account's quota
- Best-practice findings without a concrete exploit (missing rate limit headers,
  lack of subresource integrity, etc.) — report them, but no bounty
- Issues listed in our published audit findings that are tracked in
  [audit-fix-tracker.md](audit-fix-tracker.md)
- Automated scanner output without manual verification

---

## Reward tiers

Bounties are paid in USDC on Base. Amounts below are the **maximum** for each severity;
the actual payout is decided by the security committee using the Immunefi severity
classification v2.3 as a reference.

| Severity | Contracts | Web / Server / Indexer | Mobile |
| -------- | --------- | ---------------------- | ------ |
| Critical | $25,000   | $10,000                | $5,000 |
| High     | $5,000    | $2,500                 | $1,500 |
| Medium   | $2,000    | $1,000                 | $500   |
| Low      | $500      | $250                   | $250   |

### Critical — on-chain examples

- Theft of user funds or NFTs
- Unauthorized minting of $LOAR or universe tokens above supply cap
- Governance bypass that changes treasury ownership or upgrade authority
- Permanent freezing of funds (> $1k equivalent across affected users)
- Reentrancy or access control bypass in `PaymentRouter`, `CreditManager`, or any
  `Treasury*` contract

### Critical — off-chain examples

- Remote code execution on production server
- Private key / KMS credential exfiltration
- Mass account takeover (e.g. SIWE signature bypass, JWT forgery)
- Arbitrary write to Firestore admin collections (`contentAuditLog`,
  `takedownRequests`, `flags`)
- Full read of another user's credits, session, or wallet linkage

### High

- Partial theft or one-user fund loss
- Price oracle manipulation within normal market conditions
- Authorization bypass limited to a specific role (e.g. regular user gaining
  universe-admin rights on one universe)
- Bypass of rate limits leading to provider cost-abuse at scale
- Upload of content that bypasses moderation pipeline (e.g. an auth bug that
  skips the VLM moderation queue)

### Medium

- Information disclosure of non-sensitive internal data
- XSS in authenticated-only pages
- DoS of an individual creator's dashboard
- Incorrect event emission that breaks indexer state

### Low

- CSRF on non-mutating endpoints
- Missing security headers with no demonstrated exploit
- Open-redirect without a plausible phishing path

---

## Eligibility

You qualify for a bounty if **all** of the following are true:

1. You are the **first** reporter of a unique vulnerability.
2. You demonstrated the bug with a proof-of-concept and did **not** exploit it beyond
   what was necessary to prove impact. Stop at the minimum PoC.
3. You did **not** access, modify, or destroy data belonging to other users.
4. You comply with applicable laws.
5. You are **not**:
   - A current or recent (< 6 months) LOAR employee, contractor, or team member
   - A resident of a US-sanctioned jurisdiction (OFAC SDN, Iran, North Korea, etc.)
   - On any applicable sanctions list
6. You can pass basic KYC/AML for payouts ≥ $5,000 USD equivalent.

---

## Safe Harbor

We will not pursue legal action against researchers who:

- Act in good faith and follow this policy
- Avoid privacy violations, data destruction, and service disruption
- Report findings promptly via the channel below and do **not** publicly disclose
  before we've resolved the issue or the 90-day disclosure window elapses
- Do not exploit findings for personal gain beyond the bounty program

Testing against our production systems is explicitly authorized under this safe
harbor **only** when done in a minimal way to prove the bug. Mass scanning,
large-scale fuzzing, or anything that could degrade service for other users is
**not** covered.

---

## How to report

1. **Email**: `security@loar.fun` with the subject `[SECURITY] <short title>`.
   Optionally encrypt with our PGP key at [/pgp-key.txt](https://loar.fun/pgp-key.txt).
2. **Include**:
   - One-sentence summary
   - Severity self-assessment
   - Reproduction steps (exact URLs, tx hashes, request/response if HTTP)
   - Impact assessment — what could an attacker achieve?
   - Proof-of-concept code, screenshots, or tx hash
   - Your payout address (USDC on Base) and optional name/handle for credit
3. **Do not** open a public GitHub issue or post on social media.

---

## Response SLA

| Stage                      | Timeline                                  |
| -------------------------- | ----------------------------------------- |
| Acknowledgment             | ≤ 48 hours from first email               |
| Initial triage + severity  | ≤ 5 business days                         |
| Fix shipped (Critical)     | ≤ 14 days                                 |
| Fix shipped (High)         | ≤ 30 days                                 |
| Fix shipped (Medium / Low) | ≤ 90 days                                 |
| Bounty paid                | ≤ 14 days after fix is confirmed deployed |
| Public disclosure          | 90 days after fix, or by mutual agreement |

If we miss an SLA, we'll tell you why and reset the clock with your consent.

---

## Duplicate rule

The first valid report wins. If two researchers submit the same bug within 24
hours, we may split the bounty at the committee's discretion.

---

## Known issues — do not report

These are tracked in [audit-fix-tracker.md](audit-fix-tracker.md) and are not
eligible for bounty. Highlights:

- Single-EOA governance on testnet (migrating to Safe multisig pre-mainnet)
- Pending contract fixes from the 2026-04 audit sweeps (P0 / P1 list)
- Contract coverage below target — documented, in-progress

---

## Related

- [SECURITY.md](../SECURITY.md) — shorter public-facing policy
- [audit-fix-tracker.md](audit-fix-tracker.md) — known-issue list
- [incident-response.md](incident-response.md) — how LOAR handles disclosure

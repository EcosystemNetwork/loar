# KYC / AML Threshold Policy

> **Status**: Draft — MUST be reviewed by licensed counsel before enforcement.
> The figures below follow FinCEN + OFAC guidance as of 2026-04 but are not
> legal advice and may not cover state-level MSB requirements.
>
> **Last updated**: 2026-04-19
>
> **Blocks**: fiat payouts, $LOAR-to-fiat off-ramp, paid bounty disbursements ≥ threshold.

## Why this matters

LOAR does not currently custody fiat or run an exchange. That exempts us
from most MSB (Money Services Business) rules under 31 CFR § 1010.100. But
the moment we:

- Pay a bounty in USDC > $3,000
- Run a fiat off-ramp for creators (Stripe Connect, card-to-bank payouts)
- Broker a large $LOAR ↔ USD trade

… we cross into territory where FinCEN and some state regulators could view
us as an MSB. This doc sets the thresholds where we require identity
verification so we stay on the right side of that line.

## Thresholds

| Event                       | Threshold (USD eq.)      | Verification required                                                 | Records kept   |
| --------------------------- | ------------------------ | --------------------------------------------------------------------- | -------------- |
| Bug bounty payout           | $3,000                   | W-9 (US) / W-8BEN (non-US); OFAC sanctions check                      | 5 years        |
| Bug bounty payout           | $10,000                  | ID verification (government ID + selfie via vendor); Form 1099 issued | 7 years        |
| Creator fiat payout         | Any amount               | W-9 / W-8BEN; OFAC check                                              | 5 years        |
| Creator fiat payout         | $600 / year (cumulative) | 1099-NEC issued                                                       | 7 years        |
| Card purchase of credits    | $1,000 / 24h             | Stripe Radar rules flag for review                                    | Stripe retains |
| $LOAR-for-fiat swap         | N/A                      | Not offered — third-party DEXs only                                   | —              |
| Treasury → external address | $10,000                  | OFAC sanctions screen before execution                                | 7 years        |

USD equivalents computed at the Chainlink ETH/USD feed at time of event.

## Geographic exclusions (hard blocks)

Enforced by IP geolocation + wallet-linked-address jurisdiction inference:

- **OFAC sanctioned jurisdictions**: Iran, North Korea, Syria, Cuba, Crimea,
  Donetsk, Luhansk regions
- **Comprehensive embargo**: any country on the OFAC SDN list as updated
- **OFAC SDN-listed wallet addresses**: screened via Chainalysis / TRM
  Labs API before any payout or smart-contract interaction

Soft-block (warn user but allow):

- Users from jurisdictions with unclear crypto regulatory status. Reviewed
  quarterly; may become hard blocks as rules evolve.

## Sanctions screening

- **Pre-transaction**: every payout > $1,000 runs an OFAC SDN check against
  the recipient's wallet. Implementation: server calls Chainalysis KYT or
  TRM Labs `address/screen`. Block on match.
- **Per-user**: on first sign-in, screen the connecting wallet address.
  Cache the result for 24 h, re-screen on cache expiry.
- **Failure mode**: if the screening API is down, hold the payout and alert
  ops. Never auto-approve on screening failure.

## Verification vendor (TBD)

Options to evaluate, in decreasing preference:

1. **Persona** — crypto-native, good SDK, pay-per-verification
2. **Sumsub** — comprehensive, slower integration
3. **Onfido** — enterprise-grade, over-kill for our volume
4. **Veriff** — middle ground

Pick before the first > $10k payout happens. `ops/compliance-vendor.md`
should capture the choice + contract terms once signed.

## Data minimization

We collect the minimum required to satisfy each threshold:

- **Under $3k payout**: no collection beyond wallet + email (already present)
- **$3k – $10k**: W-9/W-8BEN only (name, address, TIN/ITIN, signature)
- **Above $10k**: full KYC (gov ID + selfie). Vendor holds the ID image;
  we receive only `{ verified: bool, riskScore, country }`.

Tax IDs are **encrypted at rest** (Firestore KMS-backed customer-managed key)
and never appear in logs or Sentry events.

## Retention

- KYC data: 7 years per BSA requirements
- Tax forms: 7 years
- Sanctions-screen logs: 5 years
- Automated deletion after retention via scheduled job; append a row to
  `complianceDeletionAudit` so the erasure itself is auditable.

## User rights

- **Right to access**: users can request all compliance data we hold about
  them via `compliance@loar.fun`.
- **Right to correction**: if name/address is wrong, user can re-verify.
- **Right to erasure**: limited — we must retain KYC data per BSA. We can
  hide it from internal tools but not delete before retention window.

## Implementation sketch

No code exists yet for any of this. When we build it:

- New tRPC namespace: `compliance.*` (admin-only)
- New collections: `kycRecords`, `sanctionsChecks`, `complianceDeletionAudit`
- New background job: daily re-screen of cached sanctions results
- Guard util: `requireKyc(thresholdTier)` that throws before any payout or
  treasury-outbound transfer

## Decision checklist before enabling fiat off-ramps

- [ ] Legal opinion from US counsel on MSB exposure
- [ ] State-by-state review (TX, NY, CA are the big ones)
- [ ] Vendor contract signed (KYC + sanctions)
- [ ] Firestore encryption keys rotated and logged
- [ ] Compliance officer named — a real human with legal training, or a
      contracted fractional CCO until volume justifies FTE
- [ ] SAR (Suspicious Activity Report) workflow defined

## Related

- [compliance-tax-reporting.md](compliance-tax-reporting.md) — 1099 + info returns
- [privacy-policy.md](privacy-policy.md) — data handling commitments
- [SECURITY.md](../SECURITY.md) — data handling commitments

# Tax Reporting Policy

> **Status**: Draft — MUST be reviewed by a CPA licensed in the relevant
> jurisdictions before enforcement. Numbers follow 2026 IRS thresholds but
> may shift; re-verify each January before the next tax year begins.
>
> **Last updated**: 2026-04-19

## Scope

This doc covers the forms and thresholds LOAR must generate or collect
for **US-taxable events**. Non-US creators have their own rules documented
in the bottom section. Crypto-specific forms (1099-DA, 1099-B) come into
effect 2026-2027 per IRS digital asset broker rules — we need to be ready.

## What we will need to issue

### 1099-NEC — Non-employee compensation

**Issued when**: total payments to a US creator exceed $600 in a calendar
year. Applies to:

- Revenue share to universe creators (platform → creator wallet)
- Bug bounty payouts to US recipients
- Any paid contributor / consultant / contractor

**What we need from the recipient**: W-9 (collected at the first payment,
kept on file).

**What we need to report**: name, address, TIN, total paid. Submitted to
IRS + recipient by Jan 31 of the following year.

### 1099-K — Payment card & third-party network

**Issued when**: gross payments processed to a US payee exceed $20,000 AND
200 transactions in a calendar year (pre-2024 rules). Threshold dropped to
$5,000 for 2024, $2,500 for 2025, and $600 beginning 2026.

**Who issues**: typically Stripe — they handle 1099-K for their Connect
payees. **We must confirm** we've configured Stripe Connect to collect W-9s
and issue 1099-Ks automatically. If we ever bypass Stripe and route fiat
directly, we become the filer.

### 1099-DA — Digital asset transactions (effective TY 2025)

**Issued when**: we act as a "digital asset broker" (per IRS Final Rule,
RIN 1545-BQ22). The definition is broad enough that:

- Running a managed custodial wallet → broker
- Operating a centralized marketplace → broker
- Operating a DEX frontend → **gray area**; IRS has delayed enforcement for
  non-custodial DEXs pending further guidance
- Running a creator payout system where we control the outbound wallet → broker

**Our current posture**: LOAR does not custody creator wallets. Creators hold
keys themselves (thirdweb in-app wallets are self-custodial from the user's
perspective even though thirdweb stores the shards). **Counsel must confirm**
whether thirdweb's custody model triggers broker status for us.

**If we are a broker**: 1099-DA includes gross proceeds, cost basis (as of
2026), and counterparty info. Burden is substantial. Plan accordingly.

### 1042-S — Foreign person's US-source income

**Issued when**: payments to non-US persons exceed $0 (no de minimis).

**What we need**: W-8BEN at first payment. Apply treaty rate withholding
if claimed; otherwise 30 % default withholding on US-source income.

## What we collect up front

| Recipient type    | Threshold to trigger collection | Form     |
| ----------------- | ------------------------------- | -------- |
| US individual     | First dollar                    | W-9      |
| US entity         | First dollar                    | W-9      |
| Non-US individual | First dollar                    | W-8BEN   |
| Non-US entity     | First dollar                    | W-8BEN-E |

Forms are collected via the KYC vendor's e-form flow (see
[compliance-kyc-aml.md](compliance-kyc-aml.md)). TINs are encrypted at rest,
redacted from all logs, never shown in admin tooling by default.

## Year-end workflow (automated)

Runs in January after year close:

1. Aggregate payout totals per recipient from `paymentsLedger`
2. Filter to recipients over per-form thresholds
3. For each, fetch the relevant W-9/W-8 from `kycRecords`
4. Generate 1099-NEC / 1099-DA / 1042-S PDFs (vendor: Track1099 or similar)
5. E-file with IRS via vendor
6. Mail / email copy to recipient by Jan 31
7. Archive all issued forms in `taxArchive/{year}/{recipient}`

No human step required for the happy path. Edge cases (missing W-9, address
bounce, TIN mismatch) get escalated to the compliance inbox.

## State income tax reporting

California, New York, and ~20 other states require their own 1099 filings.
The chosen vendor (Track1099 / Payable) typically handles state filing as
an add-on. Confirm when vendor is selected.

## Creators' own obligations

We provide each creator, at year end, a consolidated **earnings summary**
via their dashboard. Covers:

- Gross revenue from platform sales (clarified per source)
- Gas fees LOAR subsidized on their behalf (informational — taxable benefit)
- $LOAR token grants at fair market value on grant date
- USDC / ETH received

This is **not a tax form** — it's a creator aid. US creators still file their
own Schedule C. We include a footer: "Consult a tax professional."

## Non-US creators

- Treaty-rate withholding applied when W-8BEN is on file
- 1042-S issued by Mar 15 of the following year
- Creator receives a copy plus a cover letter explaining what it is
- We do **not** file with the creator's home-country tax authority; that's
  their obligation

## Crypto-specific disclosures

We will disclose in the Terms of Service:

- "Receiving $LOAR or USDC from the platform may be taxable in your
  jurisdiction. Consult a tax advisor."
- "We may report your earnings to tax authorities. By using the platform
  you consent to this reporting where required by law."

## Decision checklist

- [ ] CPA opinion on whether thirdweb custody triggers broker status for us
- [ ] Vendor selected (Track1099 / Payable / Tax1099)
- [ ] Stripe Connect 1099-K automation confirmed
- [ ] KYC vendor integration includes W-9/W-8 collection
- [ ] `taxArchive` Firestore collection with write-once rules
- [ ] TIN encryption keys in KMS
- [ ] Year-end job scheduled + smoke-tested on sample data

## Related

- [compliance-kyc-aml.md](compliance-kyc-aml.md) — identity verification
- [terms-of-service.md](terms-of-service.md) — user-facing tax disclosures
- [privacy-policy.md](privacy-policy.md) — data handling

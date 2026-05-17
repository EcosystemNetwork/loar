# Security Policy

## Supported Versions

| Version | Supported          | Network                                |
| ------- | ------------------ | -------------------------------------- |
| `main`  | :white_check_mark: | Sepolia + Base Sepolia + Solana Devnet |
| 0.1.x   | :white_check_mark: | Testnet                                |
| < 0.1   | :x:                | —                                      |

Mainnet (Base L2 + Solana mainnet-beta) is not yet deployed; see [`docs/launch-readiness.md`](docs/launch-readiness.md) for the gating checklist.

## Reporting a Vulnerability

We take the security of the LOAR protocol seriously. If you believe you have found a security vulnerability, please report it responsibly.

### How to Report

**DO NOT** open a public GitHub issue for security vulnerabilities.

1. **Email**: Send a detailed report to **security@loar.fun**
2. **Subject line**: `[SECURITY] Brief description of the issue`
3. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
   - Suggested fix (if any)

### Response Timeline

| Stage              | Timeline                                    |
| ------------------ | ------------------------------------------- |
| Acknowledgment     | Within 48 hours                             |
| Initial assessment | Within 5 business days                      |
| Resolution target  | Within 30 days for critical issues          |
| Public disclosure  | After fix is deployed + 30-day grace period |

### Bug Bounty Program

We offer rewards for responsibly disclosed vulnerabilities based on severity:

| Severity     | Reward Range     | Examples                                                                                 |
| ------------ | ---------------- | ---------------------------------------------------------------------------------------- |
| **Critical** | $5,000 – $25,000 | Loss of funds, unauthorized minting, governance bypass, private key exposure             |
| **High**     | $2,000 – $5,000  | Unauthorized state changes, access control bypass, reentrancy in fund-handling contracts |
| **Medium**   | $500 – $2,000    | DoS on critical paths, information disclosure, front-running vulnerabilities             |
| **Low**      | $100 – $500      | Non-critical DoS, incorrect event emission, gas optimization in critical paths           |

### Scope

**In scope:**

- EVM smart contracts in `apps/contracts/src/` (69 contracts, including UUPS singletons + Beacon NFT proxies)
- Anchor / Solana programs in `apps/programs/programs/` (16 programs on devnet — universe, episode, payment, canon_market, licensing, staking, subscription, credit_manager, collab_manager, split_router, rights, fee_locker, bonding_curve, remix_fees, premium_actions)
- Cross-chain bridge (custodial v1 + Wormhole NTT v2) — caps, idempotency, reconciliation
- Server-side authentication and authorization (`apps/server/src/`)
- SIWE session management + Circle DCW signing path (KMS-backed)
- BYOK provider keys store (`apps/server/src/services/provider-keys/`) — encryption, key isolation, dispatcher routing
- Payment and credit handling logic (reserve / reconcile primitives in `services/credit-reservation/`)
- Storage upload and retrieval paths (Pinata, Lighthouse, Firebase fallback) + CSAM moderation gate
- Cross-contract interactions and upgrade paths
- Outbound webhook HMAC signing
- MCP server tool surface (`apps/mcp/`) — scope gates, rate limits

**Out of scope:**

- Third-party dependencies (report upstream)
- Issues requiring physical access
- Social engineering attacks
- Known issues listed in our audit findings (see [`docs/audit-fix-tracker.md`](docs/audit-fix-tracker.md))
- Frontend-only cosmetic issues
- Testnet deployments (unless the bug would affect mainnet)
- Issues reachable only with a stolen/compromised Circle DCW master key (assumed compromised = recovery scenario, not vuln)

### Eligibility

- First reporter of a unique vulnerability
- Must not exploit the vulnerability beyond proof-of-concept
- Must not access or modify other users' data
- Must comply with applicable laws
- Must not be a current or recent (< 6 months) team member

### Safe Harbor

We will not pursue legal action against researchers who:

- Act in good faith and follow this policy
- Avoid privacy violations, data destruction, and service disruption
- Report findings promptly and do not publicly disclose before resolution
- Do not exploit findings for personal gain beyond the bounty program

### Smart Contract Specifics

Our protocol uses:

- OpenZeppelin 5.0.2 upgradeable contracts (UUPS pattern for singletons, Beacon proxies for per-universe NFTs)
- Single EOA ownership (testnet) — Gnosis Safe multisig + TimelockController planned before mainnet (GOV-01 in the audit-fix tracker)
- Per-universe TimelockController governance (24h delay) for universe-level proposals
- Pull-payment pattern in PaymentRouter
- Custom errors over `require` strings on 13+ low-churn contracts (gas + clearer revert reasons)
- Storage-layout baselines committed at `apps/contracts/storage-layouts/baseline/`; CI diffs every PR

Critical areas of interest (EVM):

- UUPS upgrade authorization paths
- TimelockController role management + factory-admin handoff
- PaymentRouter fee calculations and fund routing
- CreditManager balance manipulation
- Cross-contract call chains (RightsRegistry → PaymentRouter → Treasury)
- Voting and snapshot mechanisms in CanonMarketplace
- LaunchpadStaking reward accounting (sandwich resistance)
- ContentLicensing rights-check on bounty award path

Critical areas of interest (Solana):

- Anchor account validation + PDA seed integrity (especially `premium_actions`, formerly `loar_burner` — devnet program ID is preserved across the rename)
- Custodial bridge `lock` / `mint` paths — per-tx caps, per-user caps, idempotency keys, balance prechecks
- Cross-chain attestation Ed25519 verification (`/api/solana/attestation/key`)
- Squads multisig propose / approve / execute flow
- Token-2022 `lock_loar_mint` one-way mint disable
- Reserve / reconcile credit accounting in `credit_manager` parity with the EVM CreditManager

### Related docs

- [Audit Fix Tracker](docs/audit-fix-tracker.md) — 157 findings across 9 review passes
- [Bug Bounty (extended)](docs/bug-bounty.md) — scope details, payout matrix, triage SLA
- [External Audit Engagement](docs/external-audit-engagement.md) — Code4rena/Sherlock playbook
- [Security Audit Response 2026-04-22](docs/security-audit-response-2026-04-22.md) — disposition of Lane 1–4 findings
- [Launch Readiness Scorecard](docs/launch-readiness.md) — operational + legal gates before mainnet

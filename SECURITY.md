# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

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

- Smart contracts in `apps/contracts/src/`
- Server-side authentication and authorization (`apps/server/src/`)
- Payment and credit handling logic
- SIWE session management
- Storage upload and retrieval paths
- Cross-contract interactions and upgrade paths

**Out of scope:**

- Third-party dependencies (report upstream)
- Issues requiring physical access
- Social engineering attacks
- Known issues listed in our audit findings
- Frontend-only cosmetic issues
- Testnet deployments (unless the bug would affect mainnet)

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

- OpenZeppelin 5.0.2 upgradeable contracts (UUPS pattern)
- Single EOA ownership (testnet) — Gnosis Safe multisig + TimelockController planned before mainnet
- Per-universe TimelockController governance (24h delay) for universe-level proposals
- Pull-payment pattern in PaymentRouter
- Beacon proxies for NFT contracts

Critical areas of interest:

- UUPS upgrade authorization paths
- TimelockController role management
- PaymentRouter fee calculations and fund routing
- CreditManager balance manipulation
- Cross-contract call chains (RightsRegistry → PaymentRouter → Treasury)
- Voting and snapshot mechanisms in CanonMarketplace

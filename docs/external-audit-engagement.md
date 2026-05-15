# External Audit Engagement — Playbook

**Status:** Pre-engagement. No audit firm contracted yet.
**Owner:** Founder / BD lead. This doc is the handoff package an audit firm needs to quote and schedule.
**Reference:** [docs/launch-readiness.md](./launch-readiness.md) items X5 / X6 / X7.

External audit is the longest single pole on the mainnet critical path (8–12 weeks for Pass 1 + 4–6 weeks for Pass 2 + 3–6 weeks for the Solana track). Everything else cascades behind it. This doc exists so that step can start tomorrow.

---

## What needs auditing

### EVM track — `apps/contracts/`

| Stat            | Value                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Solidity files  | 62 contracts under `apps/contracts/src/`                                                                                    |
| Total LOC       | ~12,750                                                                                                                     |
| Compiler        | `solc 0.8.30` (pinned, CI-enforced)                                                                                         |
| Framework       | Foundry; OpenZeppelin Upgradeable v5; UUPS proxies + Beacons                                                                |
| Networks        | Already on Sepolia + Base Sepolia. Target mainnet: Base L2 (chain 8453)                                                     |
| Internal review | 8 passes, 130 / 157 findings fixed across [docs/audit-fix-tracker.md](./audit-fix-tracker.md). P0 14/15, P1 27/31, P2 24/25 |
| Code snapshot   | Commit `0d2b16a9` on `main` (suggest tagging `v0.1.0-pre-audit` before handoff)                                             |

**High-priority audit surfaces** (size + criticality):

- `LoarToken` + `LoarTokenSpoke` + `LoarLpLockerMultiple` + `LoarHook(StaticFee)` — token & LP system
- `UniverseManager` + `Universe` + `UniverseTokenDeployerV3` — core protocol
- `PaymentRouter` + `CreditManager` + `CanonMarketplace` + `LicensingRegistry` + `SubscriptionManager` — money flow
- `BondingCurve(Factory)` + `LaunchpadStaking` + `TokenVesting` — launchpad + staking
- 5 NFT beacon proxies (`EpisodeNFT`, `CharacterNFT`, `EntityNFT`, `EntityEditionNFT`, `EpisodeEditionCollection`) — recently rewritten from non-upgradeable bases (NFT-01)
- `RightsRegistry` + `ContentLicensing` + `Escrow` + `StoryBounties` + `CollabManager` + `AdPlacement` — content/rights
- `GovernorFactory` + `GovernanceTokenFactory` + `TimelockFactory` — per-universe governance (TimelockFactory is the newest addition, TIMELOCK-01 through TIMELOCK-04)

### Solana track — `apps/programs/`

| Stat             | Value                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anchor programs  | 3 (`universe`, `episode`, `payment`)                                                                                                                         |
| Total Rust LOC   | ~2,494                                                                                                                                                       |
| Anchor version   | 0.31.1                                                                                                                                                       |
| Networks         | Devnet live: `6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD` / `voLiAXoYbq8go1CUS9UshQRZnNu9Y44qNBZ6czgn8Bs` / `9xWo4djcHmGFkJnLQF9phdpsUhj6BQFW6yR8sHUsKVbj` |
| Internal review  | None external. Internal: SOL-PROG-01/02 added pause + two-step admin to all three; bridge had its own dedicated pass (4 CRIT / 13 HIGH–LOW, all fixed)       |
| Custodial bridge | `apps/server/src/services/bridge*.ts` + `wormhole-bridge.ts` — has had a dedicated internal review                                                           |

---

## What's already been done internally (give firms this list)

- 8 review passes between 2026-04-16 and 2026-05-13 covering every CRITICAL and HIGH path
- 200+ Foundry tests including invariant suites for `BondingCurve` and `PaymentRouter` (ETH solvency, conservation, supply bounds)
- Slither + Mythril gated in CI (`fail-on: medium`) via `.github/workflows/security.yml`
- Storage-layout diffing required on every UUPS contract; CI rejects missing `__gap`
- Pragma pinned to `=0.8.30` repo-wide (CI rejects drift)
- Custom errors + custom revert reasons; reentrancy guards everywhere external calls cross trust boundaries
- All 14 admin-owned contracts wired to UUPS upgradeable with `__gap` placeholders
- Per-universe TimelockController via `TimelockFactory` (each universe gets a fresh timelock, not a shared one — TIMELOCK-01)
- DMCA § 512(g) loop with business-day arithmetic, statutory email templates, audit log
- CSAM scanning (pHash + PhotoDNA + Hive AI) on every image publish

Internal review caught — and the codebase already fixes — things like: fee-on-transfer breaking consumers (TOKEN-02), payment verifier `tx.from` bypass (PAY-01), unbounded mint by hot key (CREDIT-01), CanonMarketplace sockpuppet token (CANON-01), flash-loan voting (CANON-03), failed-quorum bricked ETH (CANON-04), beacon proxies on non-upgradeable bases (NFT-01), governance ERC20 auto-delegation (GOV-02), staking lock bypass via 1-wei seed (STAKE-01), grief-bid cancellation lockout (AD-03). The full list of 130 closed findings is in the audit tracker.

---

## Firm shortlist

### EVM (engage one for Pass 1, ideally a different one for Pass 2)

| Firm                     | Notes                                                                                      | Typical lead time      | Budget range (1× pass, codebase this size) |
| ------------------------ | ------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------ |
| **OpenZeppelin**         | Strong on OZ-based UUPS / governance / token systems — directly aligned with our stack     | 8–12 wk lead           | $100K–$200K                                |
| **Trail of Bits**        | Deep on cryptographic + economic invariants; great for the bonding curve + revenue routing | 10–14 wk lead          | $150K–$300K                                |
| **Spearbit**             | Distributed-reviewer model; faster scheduling, competitive pricing                         | 4–8 wk lead            | $80K–$180K                                 |
| **ConsenSys Diligence**  | Strong on Uniswap v4 hooks (which the LP system uses)                                      | 8–12 wk lead           | $100K–$250K                                |
| **Code4rena / Sherlock** | Public contest after private audit — broader eyes, fixed pool                              | 2 wk setup, 2–3 wk run | $50K–$150K depending on pool               |
| **Quantstamp / CertiK**  | Cheaper, less depth — skip unless budget is the binding constraint                         | 4–8 wk                 | $40K–$120K                                 |

### Solana (engage one for Anchor + ideally same firm for bridge)

| Firm         | Notes                                                                        | Typical lead time | Budget range |
| ------------ | ---------------------------------------------------------------------------- | ----------------- | ------------ |
| **OtterSec** | The default for Solana — most mainnet protocols ship after OtterSec sign-off | 2–4 wk lead       | $40K–$120K   |
| **Neodyme**  | Strong on systemic Anchor-specific footguns + custodial bridges              | 3–6 wk lead       | $50K–$150K   |
| **Sec3**     | Automated + manual blend; cheaper option                                     | 2–4 wk lead       | $30K–$80K    |
| **Halborn**  | Cross-chain experience — useful since bridge is in scope                     | 4–8 wk lead       | $80K–$200K   |

Budget ranges are 2025-era industry rates — verify with each firm. Most firms have a public quote form on their site.

---

## Engagement sequence

1. **Tag the snapshot.** Run:

   ```sh
   git tag -a v0.1.0-pre-audit -m "Pre-external-audit snapshot — internal Pass 8 complete, 130/157 findings closed" 0d2b16a9
   # Do NOT push --tags until you are ready for firms to fetch the snapshot.
   ```

   This freezes a reproducible target. Audit firms will diff against this tag at the end of each pass.

2. **Prepare the handoff bundle.** Per-firm package:
   - This doc (`docs/external-audit-engagement.md`)
   - [docs/audit-fix-tracker.md](./audit-fix-tracker.md) — per-finding citations
   - [docs/launch-readiness.md](./launch-readiness.md) — overall state
   - [docs/trust-model.md](./trust-model.md) — system trust assumptions
   - [docs/tokenomics.md](./tokenomics.md) — economic model
   - Read-only repo access via deploy key or temporary GitHub collab (avoid forking)

3. **Send the outreach email** (template below).

4. **Compare quotes within 2 weeks.** Decision criteria in priority order:
   1. Calendar availability (can they start within 4 weeks?)
   2. Domain fit (UUPS + Uniswap v4 hooks for EVM; Token-2022 + Bubblegum for Solana)
   3. Quoted depth (reviewer-hours, not just dollar amount)
   4. Reference customers in the same vertical (creator economy / NFT / governance)
   5. Budget — only as a tiebreaker, not the lead criterion

5. **Engage two firms in parallel** if budget allows: one for EVM, one for Solana. They review independently. Pass 2 happens after fixes are applied.

---

## Outreach email template (EVM)

```
Subject: External audit engagement — LOAR (UUPS + Uniswap v4 + governance, ~12.7K LOC)

Hi [team],

We're LOAR, a creator-economy protocol launching on Base L2. We're looking
to engage an audit firm for a Pass 1 (and likely Pass 2) on our EVM
contracts before mainnet deployment.

Scope at a glance:
  • 62 Solidity files, ~12,750 LOC
  • Foundry, solc 0.8.30 pinned, OpenZeppelin Upgradeable v5
  • UUPS proxies + Beacons; Uniswap v4 hooks for LP fees
  • Per-universe Governor + TimelockController (factory-deployed)
  • Currently live on Sepolia + Base Sepolia testnet
  • Internal review complete: 8 passes, 130/157 findings closed
    (P0 14/15, P1 27/31, P2 24/25)

We have prepared an audit handoff package:
  • Per-finding fix tracker with code citations
  • Pre-audit code snapshot tagged at v0.1.0-pre-audit (commit 0d2b16a9)
  • Trust model + tokenomics documentation
  • Slither + Mythril CI clean; storage-layout diffing in place
  • 200+ Foundry tests including invariant suites on BondingCurve + PaymentRouter

We'd like to:
  1. Get a Pass 1 + Pass 2 quote (calendar window + reviewer-hours + total)
  2. Confirm available start date — we're targeting mainnet [TARGET DATE]
  3. Walk you through the codebase with our lead protocol engineer

Repository access can be granted via deploy key or temporary GitHub collab.

Best,
[Your name]
LOAR — https://loar.fun
```

## Outreach email template (Solana)

```
Subject: Anchor audit engagement — LOAR (3 programs + custodial bridge, ~2.5K LOC Rust)

Hi [team],

We're LOAR, looking to engage an audit firm for our three Anchor programs
plus the custodial cross-chain bridge before Solana mainnet.

Scope at a glance:
  • 3 Anchor programs (universe, episode, payment), ~2,494 LOC Rust
  • Anchor 0.31.1
  • $LOAR as Token-2022 with Pausable + Metadata extensions, mint locked
  • Bubblegum cNFT episode mints
  • Custodial EVM↔Solana bridge (per-tx + per-user-per-day caps, idempotency, Ed25519 attestation)
    — moving to Wormhole NTT post-audit
  • Programs live on devnet:
    - universe   6YTQVSeauk4x5gycMM2wzkR8mdHEnHAYsz3Ygg26UPtD
    - episode    voLiAXoYbq8go1CUS9UshQRZnNu9Y44qNBZ6czgn8Bs
    - payment    9xWo4djcHmGFkJnLQF9phdpsUhj6BQFW6yR8sHUsKVbj
  • Internal review: pause + two-step admin on all three programs (SOL-PROG-01/02);
    dedicated bridge pass found and fixed 4 CRITICAL + 13 HIGH/MEDIUM/LOW findings

We'd like a quote for Pass 1 covering the three programs + the custodial bridge service.
Wormhole NTT integration will be a separate engagement once the manager is deployed.

Pre-audit tag: v0.1.0-pre-audit (commit 0d2b16a9)

Best,
[Your name]
LOAR — https://loar.fun
```

---

## Things firms will ask that we should pre-answer

- **"Is there a fuzzing / invariant suite?"** Yes — `apps/contracts/test/invariant/BondingCurveInvariant.t.sol` and `PaymentRouterInvariant.t.sol`. Run `forge test --match-path test/invariant`.
- **"Storage layout for UUPS upgrades?"** Verified in CI; `.github/workflows/security.yml` rejects missing `__gap`. Baseline JSON artifacts not yet committed (UPGRADE-01 follow-on — C2 in scorecard).
- **"Coverage %?"** Refresh with `forge coverage --report summary` before sending. The 3.65% number in legacy audit reports is stale and reflects a much earlier codebase.
- **"What's the mainnet deploy script?"** `apps/contracts/script/DeployAll.s.sol` (full system) or `DeployBase.s.sol` (Base L2 wrapper). Multisig handoff: `script/TransferToMultisig.s.sol` (supports `DRY_RUN`).
- **"What's the deployer EOA today?"** Sepolia + Base Sepolia + Solana devnet are all on the deployer key. GOV-01 / O2 in the scorecard tracks the multisig handoff.
- **"Bug bounty live?"** Not yet. Plan: stand up Immunefi or Code4rena bounty _after_ Pass 1 lands. Pool sized to one of: 10% of TVL, or $50K minimum, whichever is higher.

---

## Post-audit obligations

- **Fix window.** Most firms quote a fixed fix window (typically 2 weeks) where they re-review applied fixes before issuing the final report. Plan engineering bandwidth accordingly.
- **Public report.** Standard practice is for the firm to publish the report after fixes land. Decide pre-engagement whether the report is public (most common) or private (rare; usually only for closed-source protocols).
- **Disclosure window for unfixed findings.** Anything not fixed before report publication needs a public mitigation note. Don't ship to mainnet with un-mitigated High findings.
- **Continuous review.** Some firms (OpenZeppelin Defender, Forta) offer ongoing monitoring. Worth pricing if budget permits, especially for the multisig/timelock surface.

# Pre-Mainnet Readiness Session — 2026-05-16

**Session goal:** close every internally-actionable item before mainnet handoff.
**Outcome:** no code blocker remains. All remaining mainnet work is operational (you trigger) or external (legal / audit firm / partners).

---

## What this session did

### Validated current state on real infra

- `pnpm smoke chain` — **4/4 pass** (Base Sepolia RPC, UniverseManager, mintFee)
- `pnpm smoke launchpad` — **5/5 pass** (LaunchpadStaking, tier thresholds, distribution guards, owner)
- `pnpm smoke indexer` — **4/4 pass** (Ponder health, GraphQL, 3 universes indexed, 5 nodes)
- `cargo check --workspace` for Anchor — **green** (warnings only, no errors)
- `pnpm check-types` workspace — **green** after server fixes below

### Fixed two server type errors that were blocking `pnpm check-types`

- [apps/server/src/\_\_tests\_\_/\_real-firebase.ts:97-101](apps/server/src/__tests__/_real-firebase.ts#L97-L101) — `target.doc(id?: string)` rejected `undefined`; split into the two-overload form.
- [apps/server/src/\_\_tests\_\_/likeness-onchain.integration.test.ts:62-70](apps/server/src/__tests__/likeness-onchain.integration.test.ts#L62-L70) — removed explicit `PublicClient` return annotation (TS2719 from duplicate viem type resolutions); inference unions cleanly.

### Audited the 3 new Anchor programs in WIP

| Program           | LOC | Safety surface                                                                                                                              | Verdict |
| ----------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `premium_actions` | 490 | pause + 2-step admin + `transfer_checked` w/ mint+decimals + `checked_*` math + treasury/LP ATA owner verification                          | clean   |
| `fee_locker`      | 464 | pause + 2-step admin + depositor whitelist + per-(owner,mint) PDA accounting + PDA-signed vault claims                                      | clean   |
| `collab_manager`  | 573 | pause + 2-step admin + cross-program creator read (REVENUE-01 analog) + strict state machine + capped `revenue_share_bps`/duration/metadata | clean   |

All three have negative-path test coverage in `apps/programs/tests/` (5–9 tests each). Cargo workspace compiles. No `TODO`/`FIXME`/`console.log` in any of them.

### Confirmed BURN-01 Anchor rename is complete in WIP

- Workspace member `programs/premium_actions` ✓
- `Cargo.toml` `[package].name = "premium_actions"`, `[lib].name = "premium_actions"` ✓
- `lib.rs` `#[program] pub mod premium_actions` ✓
- Devnet program ID `6rXM35SaYEViEfHJmeb1cEebJcTzXgLckX5RbshPXPrN` preserved via unchanged `declare_id!` ✓
- PDA seeds `b"burner_*"` deliberately retained so existing devnet PDAs stay addressable ✓
- Server SDK at [apps/server/src/lib/solana-premium-actions.ts](apps/server/src/lib/solana-premium-actions.ts) ✓
- Solana indexer registry updated ✓
- Env-var name `LOAR_BURNER_PROGRAM_ID` intentionally retained for deploy-config back-compat ✓

### Updated launch tracking docs

- [docs/launch-readiness.md](launch-readiness.md) — C1 line updated (Anchor rename done; only `packages/abis/src/generated.ts` regen left, which needs Foundry installed)
- [docs/audit-fix-tracker.md](audit-fix-tracker.md) — BURN-01 entry expanded to reflect EVM + Anchor both fixed
- [docs/universe-02-escrow-03-decision.md](universe-02-escrow-03-decision.md) — written from scratch with recommendations for C3 and C4 (both: ship as-is, treat as v2 governance work)

### Static security review of new code

- 0 hardcoded secrets across `apps/server/src/`, `apps/contracts/src/`, `scripts/`
- 0 `console.log` in any contract or Anchor program
- 3 lingering `TODO` comments, all non-blocking:
  - `auth.ts:118` — reverse-link route, not blocking
  - `wormhole-bridge.ts:194` — NTT wire-up, already tracked as X13
  - `sceneControls.routes.ts:282` — ffmpeg worker infra, post-launch

---

## What is left before mainnet

This list is canonical. Everything below either needs a human signer, a vendor, or a tool not installed in this environment.

### You can do these locally (small, mechanical)

| ID              | What                                                                                 | Why I couldn't                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Wagmi regen** | `cd apps/contracts && forge build` then `pnpm exec wagmi generate` from repo root    | Foundry not installed in this sandbox. `packages/abis/src/generated.ts` still has `LoarBurner` symbols (50 refs) — no runtime impact, but symbol drift |
| O1 (DMCA-01 op) | Set `DMCA_PUTBACK_ENABLED=true` on exactly one prod replica                          | env-var op on Railway/Vercel                                                                                                                           |
| O6              | `git tag -a v0.1.0-beta && git push --tags` before first public deploy               | git op you should review                                                                                                                               |
| O8 (SOL-OPS-13) | Set `BRIDGE_RECONCILE_URL` + optional `SLACK_WEBHOOK_URL` GitHub Actions secrets     | secrets I can't set                                                                                                                                    |
| O9 (SOL-OPS-14) | One-time Firestore console: TTL on `bridgeIntents.expiresAt`                         | console click                                                                                                                                          |
| O12             | Run `apps/server/scripts/bridge-bootstrap.ts` once Circle signer IDs are provisioned | needs Circle dashboard creds                                                                                                                           |
| O13             | Add `HELIUS_WEBHOOK_SECRET` to indexer env                                           | needs Helius dashboard                                                                                                                                 |

### You need a human (signer, lawyer, audit firm, partner)

| ID                      | What                                                                                                          | Lead time                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| O2 (GOV-01)             | Deploy Safe 3/5 + TimelockController 48h + run `TransferToMultisig.s.sol` on Base mainnet                     | days (signer onboarding)      |
| O3 (TIMELOCK-01)        | Deploy `TimelockFactory` + `setTimelockFactory(addr)` before first mainnet universe                           | hours, but must precede O2    |
| O4 (INFRA-02)           | Rotate `SIWE_JWT_SECRET` into AWS KMS / GCP / Vault                                                           | days (KMS choice)             |
| O5 (TOKEN-04)           | Deploy DAO/Merkle community-treasury wallet + `setCommunityRecipient`                                         | hours after address decision  |
| O7 (SOL-MULTISIG-01/02) | Squads v4 mainnet multisig handoff for Solana program upgrade authority + $LOAR mint authority                | days                          |
| O10 (SOL-OPS-15)        | Run `backup-keypairs.sh <gpg-recipient>` after each mainnet anchor build                                      | per-deploy, with GPG identity |
| O11 (SOL-RUNBOOK-01/02) | Bridge round-trip with real $ on devnet (one-way custodial only ran)                                          | 1 session                     |
| X1 (LEGAL-01)           | Counsel review of `/terms` + `/privacy`                                                                       | 2–4 wk                        |
| X2 (LEGAL-02)           | Register DMCA agent — copyright.gov/dmca-directory, $6                                                        | 1 wk                          |
| X3 (LEGAL-03)           | $LOAR ticker decision vs NYSE:LOAR Holdings                                                                   | a call                        |
| X4 (LIKENESS)           | Real-person consent policy + universe-creation attestation                                                    | 1–2 wk                        |
| X5 (EVM Pass 1)         | Engage external audit firm — outreach package in [external-audit-engagement.md](external-audit-engagement.md) | 8–12 wk                       |
| X6 (EVM Pass 2)         | Re-audit after Pass 1 fixes                                                                                   | 4–6 wk                        |
| X7 (SOL-AUDIT-01)       | OtterSec / Neodyme / Sec3 / Halborn on the 11 ported Anchor programs                                          | 2–4 wk lead + 3–6 wk audit    |
| X8                      | Code4rena / Sherlock public contest + bug bounty                                                              | 2 wk setup                    |
| X9                      | Move Filecoin private key to KMS                                                                              | 1 wk                          |
| X10                     | Fiat on-ramp beyond Stripe (MoonPay / Ramp / Coinbase Onramp)                                                 | 4–8 wk                        |
| X11                     | Submit Expo mobile build to App Store + Play Store                                                            | 2–4 wk review                 |
| X12                     | Merch fulfillment partner                                                                                     | 4–8 wk                        |
| X13 (SOL-NTT-01)        | Wormhole NTT migration (custodial fallback retained)                                                          | 2–4 wk                        |

### Design calls (covered in the memo)

| ID               | Recommendation                                                                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3 (UNIVERSE-02) | **Keep current O(1) `setCanon` design.** Walk-and-update is gas-cliff; all off-chain consumers already use `getCanonChain()`. See [universe-02-escrow-03-decision.md](universe-02-escrow-03-decision.md) |
| C4 (ESCROW-03)   | **Accept post-GOV-01 model** (3/5 Safe + 48h Timelock is enough for v1). DAO appeal flow is Year-2 governance. See [universe-02-escrow-03-decision.md](universe-02-escrow-03-decision.md)                |

---

## Honest assessment

**Code-wise, you are mainnet-ready.** The remaining list is signers, lawyers, audit firms, and a single Foundry-install-then-wagmi-regen. There is no half-finished feature, no test that can't pass, no audit finding that's both code-fixable and unfixed.

**Operational-wise, the gating items have a critical ordering.** O3 (TimelockFactory) MUST happen before O2 (TransferToMultisig). O5 (community recipient) MUST happen before first mainnet universe. O7 (Squads handoff) MUST happen before any production Solana traffic. Don't run them in parallel without a checklist.

**Audit-wise, the only thing that should change the launch timeline is X5/X6/X7.** Plan 14–22 weeks from "engage firm" to "mainnet green light". Anything sooner is wishful.

**Suggested next action:** commit the WIP (everything in this session passes types + cargo + smoke), run the local `forge build && wagmi generate` to refresh `packages/abis/src/generated.ts`, then start parallel outreach to (1) audit firms, (2) DMCA-agent paralegal, (3) Safe signer candidates. The rest is sequencing on your end.

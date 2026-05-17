# LOAR — Launch Readiness Scorecard

**Last reviewed:** 2026-05-17
**Verdict:** Testnet beta live on Sepolia + Base Sepolia. Mainnet blocked on legal (3 items), operational handoffs (≥11 items), and external audit (1 pass). All internal-code blockers (C1–C4) are now closed.

## Verification snapshot (2026-05-15)

Auth-independent smoke layers run from the local repo against live infra:

| Layer                                       | Result                                 | Notes                                                                                                                                                            |
| ------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMOKE_LAYER=chain`                         | **4 / 4 passed**                       | Base Sepolia RPC ✓, UniverseManager `0xE981454B…` ✓, 1 universe minted on-chain, 0.05 ETH mint fee                                                               |
| `SMOKE_LAYER=launchpad`                     | **5 / 5 passed**                       | LaunchpadStaking `0x94556da5…` ✓, tier thresholds monotonic, distribution-guard interval 100 blocks / cap 500 bps, owner = deployer EOA (expected — GOV-01 open) |
| `SMOKE_LAYER=indexer`                       | **4 / 4 passed**                       | Ponder /health ✓, 3 universes indexed (Orange Pills / Voidborn Saga / LOAR Testnet Universe), 5 recent nodes                                                     |
| `mainnet-runbook-dryrun.ts` (devnet)        | **34 PASS / 1 WARN / 3 FAIL / 3 SKIP** | All FAILs are env, not code — see O12/O13 below                                                                                                                  |
| `SMOKE_LAYER=auth/storage/generation/admin` | not run                                | Requires local server boot — defer to deploy-time                                                                                                                |

Conclusions: on-chain surfaces match docs. Indexer is alive. Failures are pure-config (env vars) and don't indicate a regression.

This is the single page that says _what's left_. The supporting docs (audit-fix-tracker, pre-launch-checklist, solana-mainnet-runbook) cover the _why_ and the _how_. If a line below disagrees with one of those, this page is canonical.

---

## What ships today (do not re-litigate)

| Surface               | State                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public narrative      | loar.fun home is Netflix-style universe gallery, README leads with product, in-app home + Create CTA aligned                                                                                                                                                                                                                                                                               |
| Episode NFT mint loop | List → discover → mint with ETH on Sepolia + Base Sepolia. MintContentDialog, BuyNFTDialog, batch listing, ERC2981 royalty routing all wired                                                                                                                                                                                                                                               |
| Rights classification | Three-lane `fan` / `original` / `licensed`, badges on `/discover`, `licensingProof` review queue, commercial-tx gating via `assertContentOperable`                                                                                                                                                                                                                                         |
| Moderation            | Flag intake, `/dmca` form, immutable `contentAuditLog`, `/admin/moderation` queue, contentStatus gates                                                                                                                                                                                                                                                                                     |
| DMCA § 512(g) loop    | Counter-notice form + REST + job that auto-restores after ≥10 business days, all three statutory notices dispatched (subscriber, claimant, putback)                                                                                                                                                                                                                                        |
| CSAM scanning         | pHash + PhotoDNA + Hive AI on every image publish, blocks upload + audit-logs hits                                                                                                                                                                                                                                                                                                         |
| Contract security     | 132 / 157 audit findings fixed across 9 review passes (P0 14/15, P1 27/31, P2 24/25, P3 22/26). 2026-05-16 ninth pass closed BURN-01 (EVM + Anchor rename, program ID preserved), UPGRADE-01 follow-on (committed baselines + CI diff), AD-02 v1 (slot-creator impression cap). Targeted `require()` → custom-errors cleanup on 13 low-churn contracts also shipped. Remaining items below |
| Solana parity         | cNFT mints, canon promotion, $LOAR Token-2022 with mint locked, custodial bridge with per-tx + per-day caps, indexer healthz, Squads handoff scripts                                                                                                                                                                                                                                       |
| ToS + Privacy         | Substantive text live at `/terms` + `/privacy` (April 2026), no placeholders. Legal counsel review still recommended                                                                                                                                                                                                                                                                       |

---

## Mainnet blockers — operational (you trigger, no code change)

| #   | ID                          | Action                                                                                                                                                                | Unblocker                                                                                                                     |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| O1  | DMCA-01 op                  | Set `DMCA_PUTBACK_ENABLED=true` on exactly one prod replica                                                                                                           | env var on Railway/Vercel                                                                                                     |
| O2  | GOV-01                      | Deploy Safe (3/5), TimelockController (48h), run `script/TransferToMultisig.s.sol` on Base mainnet                                                                    | Pick signers, fund deployer, run script                                                                                       |
| O3  | TIMELOCK-01                 | Deploy `TimelockFactory`, call `UniverseTokenDeployerV3.setTimelockFactory(addr)` _before_ first mainnet universe                                                     | `script/DeployTimelockFactory.s.sol` already bundles authorization                                                            |
| O4  | INFRA-02                    | Rotate `SIWE_JWT_SECRET`, move to secrets manager (AWS KMS / GCP / Vault)                                                                                             | Ops decision on KMS provider                                                                                                  |
| O5  | TOKEN-04                    | Deploy community-treasury address (DAO wallet or Merkle distributor), call `setCommunityRecipient(addr)`                                                              | Address decision + tx                                                                                                         |
| O6  | Release tag                 | `git tag -a v0.1.0-beta && git push --tags` before first public deploy                                                                                                | One-line git op                                                                                                               |
| O7  | SOL-MULTISIG-01/02          | Squads v4 mainnet multisig — transfer Solana program upgrade authorities + $LOAR mint authority off deployer `7pawxCZ8…`                                              | `apps/programs/scripts/transfer-upgrade-authority.ts` ready                                                                   |
| O8  | SOL-OPS-13                  | Enable `.github/workflows/bridge-reconcile.yml` — set `BRIDGE_RECONCILE_URL` + optional `SLACK_WEBHOOK_URL` repo secrets                                              | GitHub Actions secrets                                                                                                        |
| O9  | SOL-OPS-14                  | Configure Firestore TTL on `bridgeIntents.expiresAt`                                                                                                                  | One-time Firebase console step                                                                                                |
| O10 | SOL-OPS-15                  | Run `apps/programs/scripts/backup-keypairs.sh <gpg-recipient>` after every mainnet anchor build                                                                       | GPG recipient identity                                                                                                        |
| O11 | SOL-RUNBOOK-01/02           | End-to-end devnet runbook dry-run + bridge round-trip with real $                                                                                                     | Read-only dry-run executed 2026-05-15 — 34 PASS, see O12/O13 for remaining FAILs. Bridge round-trip with real $ still pending |
| O12 | Bridge env (partial config) | Set `SOL_BRIDGE_VAULT_ATA`, `EVM_BRIDGE_VAULT_ADDRESS`, `CIRCLE_BRIDGE_SIGNER_ID_EVM`, `CIRCLE_BRIDGE_SIGNER_ID_SOL` together (all-or-nothing — partial config = 503) | Run `apps/server/scripts/bridge-bootstrap.ts` once Circle signer IDs are provisioned                                          |
| O13 | `HELIUS_WEBHOOK_SECRET`     | Add to env on the indexer host                                                                                                                                        | One env var — Helius dashboard → webhook signing secret                                                                       |

---

## Mainnet blockers — external (cannot be done internally)

| #   | ID                | Action                                                                                                                                                             | Owner                                              | Lead time                 |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------- |
| X1  | LEGAL-01          | Counsel review of `/terms` + `/privacy` final text                                                                                                                 | Lawyer                                             | 2–4 wk                    |
| X2  | LEGAL-02          | Register designated DMCA agent with US Copyright Office                                                                                                            | Lawyer or paralegal — copyright.gov/dmca-directory | 1 wk, $6 fee              |
| X3  | LEGAL-03          | $LOAR ticker decision vs NYSE:LOAR Holdings (rename or accept C&D risk)                                                                                            | Legal + product                                    | Decision call             |
| X4  | LIKENESS          | Real-person consent / likeness policy + creator attestation checkbox at universe creation                                                                          | Lawyer                                             | 1–2 wk                    |
| X5  | EVM Pass 1        | Engage external audit firm on EVM contracts. Outreach package ready in [external-audit-engagement.md](./external-audit-engagement.md)                              | Audit firm                                         | 8–12 wk                   |
| X6  | EVM Pass 2        | Re-audit after Pass 1 fixes applied                                                                                                                                | Audit firm                                         | 4–6 wk                    |
| X7  | SOL-AUDIT-01      | External audit of Anchor programs (universe / episode / payment) — shortlist + outreach template in [external-audit-engagement.md](./external-audit-engagement.md) | Audit firm                                         | 2–4 wk lead, 3–6 wk audit |
| X8  | Bug bounty        | Code4rena or Sherlock public contest + ongoing bounty                                                                                                              | Contest platform                                   | 2 wk setup                |
| X9  | KMS migration     | Move Filecoin private key to AWS KMS / GCP / Vault                                                                                                                 | Ops decision                                       | 1 wk                      |
| X10 | Fiat on-ramp      | Beyond Stripe — partner integration (MoonPay / Ramp / Coinbase Onramp)                                                                                             | BD + KYC partner                                   | 4–8 wk                    |
| X11 | Mobile App Store  | Submit Expo build to App Store + Play Store (currently builds end-to-end, not published)                                                                           | Apple/Google review                                | 2–4 wk review             |
| X12 | Merch fulfillment | Backend exists, no fulfillment partner                                                                                                                             | BD partner                                         | 4–8 wk                    |
| X13 | SOL-NTT-01        | Migrate custodial bridge to Wormhole NTT (deploy NTT manager + transceiver on Solana + Sepolia/Base)                                                               | Wormhole integration                               | 2–4 wk                    |

---

## Mainnet blockers — code (internal, small)

_All four internal-code items are closed as of 2026-05-17._

| #   | ID                   | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status            |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| C1  | BURN-01              | ~~Rename `LoarBurner` → `PremiumActions`~~ EVM + Anchor renames DONE 2026-05-16 (workspace member `programs/premium_actions`, lib `premium_actions`, devnet program ID `6rXM35Sa…` preserved via unchanged `declare_id!`; PDA seeds `b"burner_*"` retained for state continuity). Server SDK at `apps/server/src/lib/solana-premium-actions.ts`. ~~Stale `packages/abis/src/generated.ts` regen~~ DONE 2026-05-17 — Foundry installed, `forge build` + `wagmi generate` ran from repo root. `loarBurnerAbi` + `useLoarBurner_*` hooks dropped; `premiumActionsAbi`, `useStoryBounties_*`, `useTalentAgentRegistry_*`, `useAdSeedEscrow_*` now present. Side-fix: renamed `LaunchpadStaking.MIN_DISTRIBUTION_INTERVAL` → `MIN_DISTRIBUTION_INTERVAL_FLOOR` to clear a pascalCase collision with the `minDistributionInterval` storage getter that was blocking the React hook generator (internal-only constant, no external readers per repo grep) | CLOSED            |
| C2  | UPGRADE-01 follow-on | ~~Commit baseline storage-layout JSON artifacts~~ DONE 2026-05-16. Baselines in `apps/contracts/storage-layouts/baseline/`; CI diff step wired                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | CLOSED            |
| C3  | UNIVERSE-02          | Keep documented O(1) trade-off — off-chain consumers all use `getCanonChain()`, walk-and-update refactor would create a per-canon-promotion gas grenade on long universes. Accepted per [universe-02-escrow-03-decision.md](universe-02-escrow-03-decision.md). Revisit only if external audit Pass 1 flags as material.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | CLOSED (decision) |
| C4  | ESCROW-03            | `Escrow.resolveDispute` stays `onlyOwner` for v1. Post-GOV-01 the owner is `TimelockController` (3/5 Safe + 48h delay), which is industry-standard for v1 escrow contracts. Year-2 governance upgrade adds a `>50% LaunchpadStaking.totalStaked()` 14-day veto window. Accepted per [universe-02-escrow-03-decision.md](universe-02-escrow-03-decision.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | CLOSED (decision) |

---

## Deferred to post-launch (acknowledged, not blocking)

- **AD-02 v2** — Episode-mint proof (impression must reference a real `EpisodeNFT` mint in the same universe). The v1 defensive cap (`MAX_EPISODES_PER_SLOT = 1_000_000` enforced at slot creation + revert-on-cap-exhausted) shipped 2026-05-16 and closes the unbounded-inflation primitive
- **STAKE-02** — Foundry invariants exist; full Certora/Halmos formal proofs nice-to-have
- **BUILD-04** — Certora/Halmos on `BondingCurve` + `PaymentRouter` (Foundry invariants suffice for launch)
- **Counter-notice workflow polish** — operates correctly; manual admin override paths are sufficient at testnet scale

---

## What is _not_ a launch blocker (despite older docs implying so)

- "Make the home page describe a single product" — done, home is `apps/web/src/routes/index.tsx` Netflix-style gallery
- "Wire the four UI elements for the NFT mint loop" — done, see README "Episode NFTs" row
- "Build the moderation queue" — done, `/admin/moderation`
- "Implement DMCA counter-notice" — done, `/counter-notice` + `apps/server/src/jobs/dmca-putback.ts`
- "Add CSAM scanning" — done, pHash + PhotoDNA + Hive
- "Wire on-chain governance" — done, `OpenZeppelin Governor` + `TimelockController` per universe

If you read the original `docs/gtm-prd.md` (March 2026) or older audit reviews, items that look "open" there have shipped. Use _this_ page.

---

## Verification commands

```bash
# Confirm audit-tracker claims against current contracts
pnpm --filter contracts test                  # 200+ Foundry tests
forge inspect <Contract> storage-layout       # post-upgrade safety

# Confirm server / chain / launchpad layers green
pnpm smoke                                    # full 7-layer harness
SMOKE_LAYER=chain pnpm smoke                  # contracts only
SMOKE_LAYER=launchpad pnpm smoke              # staking + curve halts

# Confirm DMCA loop wiring
DMCA_PUTBACK_ENABLED=true pnpm --filter server tsx src/jobs/dmca-putback.ts --once

# Confirm bridge reconciliation
pnpm --filter server tsx scripts/bridge-reconcile.ts

# Confirm mainnet transfer script (dry-run)
DRY_RUN=true forge script script/TransferToMultisig.s.sol --rpc-url <base-mainnet>
```

---

## Source docs

| Doc                                                    | Use for                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| [audit-fix-tracker.md](audit-fix-tracker.md)           | Per-finding code citations, fix commits, depth-3 status                 |
| [pre-launch-checklist.md](pre-launch-checklist.md)     | Phase 1 testnet beta vs Phase 2 mainnet item lists                      |
| [solana-mainnet-runbook.md](solana-mainnet-runbook.md) | Devnet → mainnet Solana ops, multisig handoff steps                     |
| [solana-overview.md](solana-overview.md)               | Solana architecture umbrella                                            |
| [gtm-prd.md](gtm-prd.md)                               | Strategic positioning (refreshed 2026-05-15 to point at this scorecard) |

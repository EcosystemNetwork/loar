# PRD: Solana ↔ EVM Production Parity

**Status**: Decided — 2026-05-15
**Owner**: TBD (assign before Phase S0 kickoff)
**Decision**: Move from "EVM canonical / Solana distribution" to **symmetric production-ready stacks on both chains**.

---

## 1. Goal

Bring the Solana stack to the same production-readiness bar as the EVM stack so that every monetization, governance, and rights surface available on Base/Sepolia is available on Solana mainnet-beta with equivalent audit coverage, multisig custody, indexing, and UI.

### Non-goals

- Replacing EVM with Solana. EVM stays canonical for IP and rights.
- Reimplementing primitives that have battle-tested Solana-native equivalents (Realms/SPL Governance, Jupiter, Metaplex Core, Tensor/ME, Streamflow). Use them where viable.
- Net-new product features. Parity only — every new capability added to EVM during this work item must be added in parallel to the Solana plan or explicitly waived.

---

## 2. Current State (2026-05-15)

### Already at parity or near-parity

| Capability              | EVM                                   | Solana                                                      |
| ----------------------- | ------------------------------------- | ----------------------------------------------------------- |
| Custody / signing       | Circle DCW + KMS                      | Circle DCW + KMS (same model)                               |
| Auth                    | SIWE + JWT                            | SIWS + JWT (ns/evm/sol claims, linked sessions)             |
| Universe primitive      | `Universe.sol`, `UniverseManager.sol` | `programs/universe` (PDA, hash-equivalent to EVM)           |
| Episode mint            | `EpisodeNFT.sol`                      | `programs/episode` + Bubblegum cNFT                         |
| Canon promotion         | `EpisodeCanonized` event              | `episode::canonize` → Metaplex Core asset                   |
| Payment routing         | `PaymentRouter.sol`                   | `programs/payment` (pull accumulator, transfer_checked)     |
| Multisig                | Safe                                  | Squads v4 (`lib/squads.ts`)                                 |
| $LOAR token             | ERC20                                 | Token-2022 (mint locked on devnet, freeze nulled)           |
| Indexer                 | Ponder                                | Helius webhook → Firestore + Anchor event decoder           |
| Bridge                  | —                                     | Custodial v1 (live), Wormhole NTT path (code, not deployed) |
| Mobile wallets          | RainbowKit / WalletConnect            | Mobile Wallet Adapter (Android), universal links (iOS)      |
| MCP exposure            | —                                     | 6 tools (mint, canonize, pay, activity, attestation)        |
| CI coverage             | Forge                                 | `anchor test` workflow                                      |
| Cross-chain attestation | —                                     | Ed25519 over `{schema, mintedAt, solana, evm, lineage}`     |

### Real gaps — monetization + rights layer

The EVM stack has ~24 contracts of monetization and rights logic that have **no Solana equivalent**. This is where the asymmetry lives.

---

## 3. Gap Inventory

Mapping each EVM contract → Solana approach. **Strategy** column:

- `port` — write an Anchor program
- `native` — use a Solana-native protocol (don't reimplement)
- `n/a` — not needed on Solana (factory pattern, hook pattern, etc.)
- `defer` — explicit v2

### Marketplaces + rights (P0 — most user-visible parity gap)

| EVM contract              | Solana strategy | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Complexity |
| ------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `CanonMarketplace.sol`    | port            | **✅ devnet 2026-05-16** — `programs/canon_market` (`2T6WzMCrSRLzUp6zwPhWPuguk84pDqozs6VwrykTR25u`). Token-locked voting (lock-during-window replaces EVM snapshot model, CANON-03 analog). Three terminal states: Accepted (for ≥ quorum, for > against) / Rejected (against wins) / Expired (no quorum). Fee retained on Accepted/Rejected (CANON-06 anti-spam), refundable on Expired (CANON-04 pull pattern). Voting token sourced from `bonding_curve::Curve.token_mint` (CANON-01 sockpuppet guard). | XL         |
| `ContentLicensing.sol`    | port            | License issuance PDA + payment composition with `programs/payment`.                                                                                                                                                                                                                                                                                                                                                                                                                                        | L          |
| `LicensingRegistry.sol`   | port            | Registry PDA. Hash-keyed for cross-chain lookup.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | M          |
| `RightsRegistry.sol`      | port            | Single source of rights truth on Solana side; must mirror EVM RightsRegistry events.                                                                                                                                                                                                                                                                                                                                                                                                                       | L          |
| `SlopMarket.sol`          | native          | Use Tensor / Magic Eden cNFT marketplace SDK. Custom only for royalty enforcement glue.                                                                                                                                                                                                                                                                                                                                                                                                                    | M          |
| `Escrow.sol`              | port            | Generic escrow PDA. Pull-pattern.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | M          |
| `RemixFees.sol`           | port            | **✅ devnet 2026-05-16** — `programs/remix_fees` (`5JdzozEXeto8CRgUZmLqrtwkGtt8smpaM4vhahW1gNLs`). 3-way $LOAR split (creator/LP/treasury). Universe.creator read live.                                                                                                                                                                                                                                                                                                                                    | S          |
| `SubscriptionManager.sol` | port            | Time-gated PDA + Solana Pay recurring intents (Pay v2).                                                                                                                                                                                                                                                                                                                                                                                                                                                    | L          |
| `CreditManager.sol`       | port            | Off-chain credits + on-chain settlement, same shape as EVM.                                                                                                                                                                                                                                                                                                                                                                                                                                                | M          |

### Token economy (P1)

| EVM contract               | Solana strategy | Notes                                                                                                                                                                                                                                                                                            | Complexity |
| -------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `LoarToken.sol`            | done            | Token-2022 mint live; mint authority transfer is operational, not code.                                                                                                                                                                                                                          | —          |
| `BondingCurve.sol`         | port            | Curve PDA. Audit-blocker: B (MEV) and curve-shape parity with EVM.                                                                                                                                                                                                                               | L          |
| `LaunchpadStaking.sol`     | port            | Staking PDA. Reward-sandwich finding (LS-1) from EVM audit must be fixed in port.                                                                                                                                                                                                                | L          |
| `TokenVesting.sol`         | native          | Streamflow.                                                                                                                                                                                                                                                                                      | S (glue)   |
| `LoarLpLockerMultiple.sol` | native          | Streamflow or Meteora LP lock.                                                                                                                                                                                                                                                                   | S (glue)   |
| `LoarFeeLocker.sol`        | port            | **✅ devnet 2026-05-16** — `programs/fee_locker` (`AwUfDktCrNYe4PU7YSBgWG6sBVTQCZEMuYL9ZWsKWtde`). Multi-token pull-pattern escrow; whitelisted depositors credit per-(owner, mint) balances.                                                                                                    | S          |
| `LoarBurner.sol`           | port            | **✅ devnet 2026-05-16** — `programs/loar_burner` (`6rXM35SaYEViEfHJmeb1cEebJcTzXgLckX5RbshPXPrN`). Premium-action fee collector with LP/treasury split (default 50/50). EVM enum + custom-action paths collapsed into one `[u8;32]` keyed PDA. "Burn" is UX naming only; no supply destruction. | S          |
| `LoarSwapRouter.sol`       | native          | Jupiter API. No reimplementation.                                                                                                                                                                                                                                                                | S (glue)   |
| `LoarHook*.sol`            | n/a             | Uniswap v4 hook pattern doesn't translate. Raydium CLMM / Meteora handle fees differently.                                                                                                                                                                                                       | —          |
| `LoarFaucet.sol`           | n/a             | Devnet only; SPL airdrop covers this.                                                                                                                                                                                                                                                            | —          |
| `LoarTokenSpoke.sol`       | done            | Bridge handles cross-chain $LOAR.                                                                                                                                                                                                                                                                | —          |

### Governance (P1)

| EVM contract                 | Solana strategy | Notes                                                                    | Complexity |
| ---------------------------- | --------------- | ------------------------------------------------------------------------ | ---------- |
| `UniverseGovernor.sol`       | native          | SPL Governance / Realms. Per-universe realm, DAO token = universe token. | L (wiring) |
| `GovernorFactory.sol`        | n/a             | Realms supports multi-DAO natively.                                      | —          |
| `GovernanceTokenFactory.sol` | n/a             | SPL mint init is trivial; no factory needed.                             | —          |
| `TimelockFactory.sol`        | n/a             | SPL Governance has built-in timelock.                                    | —          |

### NFT layer (P1)

| EVM contract                   | Solana strategy | Notes                                                                              | Complexity |
| ------------------------------ | --------------- | ---------------------------------------------------------------------------------- | ---------- |
| `CharacterNFT.sol`             | native          | Metaplex Core asset, royalty plugin.                                               | M (glue)   |
| `EntityNFT.sol`                | native          | Metaplex Core asset.                                                               | M (glue)   |
| `EntityEditionNFT.sol`         | native          | Token-2022 with metadata pointer (editions).                                       | M (glue)   |
| `EpisodeEditionCollection.sol` | native          | Token-2022 with metadata pointer (editions). Episode already minted via Bubblegum. | M (glue)   |
| `IdentityNFT.sol`              | native          | Metaplex Core soulbound (freeze authority + non-transferable plugin).              | M (glue)   |
| `StructuralDeed.sol`           | native          | Metaplex Core asset with attribute plugin.                                         | M (glue)   |
| `UniverseMetadataRenderer.sol` | n/a             | Off-chain JSON via Metaplex URI standard.                                          | —          |
| `UniverseTokenDeployerV3.sol`  | done            | SPL token init covers this on Solana side.                                         | —          |

### Misc (P2)

| EVM contract                 | Solana strategy | Notes                                                         | Complexity |
| ---------------------------- | --------------- | ------------------------------------------------------------- | ---------- |
| `CollabManager.sol`          | port            | Per-universe collaborator PDA.                                | M          |
| `CollectiveTokenFactory.sol` | n/a             | Token init pattern (see Governance).                          | —          |
| `RevenueModuleFactory.sol`   | n/a             | Per-instance PDA init is the Solana pattern.                  | —          |
| `UniverseFactory.sol`        | n/a             | Single `programs/universe` + PDA init handles this.           | —          |
| `BondingCurveFactory.sol`    | n/a             | PDA init handles this.                                        | —          |
| `AnalyticsRegistry.sol`      | n/a             | Off-chain via Firestore + indexer.                            | —          |
| `PaymentRouter.sol`          | done            | `programs/payment` covers this.                               | —          |
| `SplitRouter.sol`            | port            | Split distribution PDA, could compose with Streamflow splits. | S          |

### Tally

- **port (custom Anchor)**: 12 — Canon, Licensing×2, Rights, Escrow, Subscription, Credit, BondingCurve, Staking, Collab, FeeLocker, Burner, Remix, Split (≈14 if counting all)
- **native (SDK glue)**: 12 — Slop/secondary, Vesting, LpLock, Swap, Governor, NFTs ×6
- **n/a**: 10 — factories, hooks, faucet, renderer, etc.
- **done**: 5 — Token, TokenSpoke, PaymentRouter, UniverseTokenDeployer, UniverseFactory replacement

---

## 4. Cross-Cutting Workstreams

### W1. Anchor audit (HARD BLOCKER for mainnet)

- Engage Solana-native firm: **OtterSec**, **Neodyme**, **Sec3**, **Halborn**. 2-4 week lead time + 4-6 week report.
- Two passes: (1) current 3 programs (universe/episode/payment) — schedule now, no code changes pending; (2) full ported program suite — schedule after Phase 2 below.
- Budget: ~$80-150k for each pass (estimate). Total Solana audit cost ≈ $200k.
- Cross-reference: every new finding gets a row in [audit-fix-tracker.md](audit-fix-tracker.md) with `chain: solana` prefix to keep one tracker, two chains.

### W2. Mainnet-beta deploy

- Currently devnet. Follow [solana-mainnet-runbook.md](solana-mainnet-runbook.md).
- Cost: program deploys ~$30-80, Bubblegum tree depth=14 ~$200, $LOAR mint creation ~$5, Squads vaults ~$10.
- Sequencing: must follow W1 pass 1.

### W3. Wormhole NTT migration

- Code path exists in [`wormhole-bridge.ts`](../apps/server/src/lib/wormhole-bridge.ts).
- Deploy NTT Manager + Transceiver on both chains + peer-register. 3-5 day on-chain setup.
- Keep custodial backend live as fallback until NTT proves out for 30 days.
- Trust upgrade: server custodian → Wormhole guardian quorum.

### W4. Squads multisig handover

- Operational, no code. Same shape as the EVM Safe handover (GOV-01 in audit tracker).
- Targets: program upgrade authority, $LOAR mint authority, bridge custodian (until W3 lands), tree creator.
- Script exists: `apps/programs/scripts/transfer-upgrade-authority.ts <vault>`.

### W5. Indexer IDL decoder ✅ shipped 2026-05-15

- Switched from hand-built borsh + `sha256("event:<Name>")[..8]` discriminators to IDL-driven decode via `@coral-xyz/anchor`'s `BorshEventCoder`.
- New: `apps/solana-indexer/src/program-registry.ts` — central registry. Adding a new ported program = one line.
- New: `apps/solana-indexer/scripts/smoke-decoder.ts` — round-trip smoke against deterministic payloads.
- Payment program now indexed (was missing). All events from any registered program land in `solanaEvents` collection with `program / eventName / payload` fields; typed handlers still fire for Universe/Episode.
- Unblocks: every Phase S1-S3 ported program auto-indexes the moment its IDL is registered, with no per-event borsh code.

### W6. UI symmetry

- Surfaces missing on Solana side: `/marketplace/canon`, `/marketplace/slop`, `/license/*`, `/rights/*`, `/governance/*`, `/staking/*`.
- Pattern: existing pages stay EVM-default with a chain selector. Don't fork pages per chain — branch on `useChain()` at the data-fetch layer.
- Solana Pay UI: shipped (`SolanaPayButton`). Solana Pay subscription UI: TBD with `SubscriptionManager` port.

### W7. SDK + docs

- Update `apps/mcp` tool surface to mirror EVM tools 1:1.
- `apps/programs/README.md` updated per ported program.
- New: `docs/solana-parity-matrix.md` — auto-generated from this PRD, kept in sync.

---

## 5. Sequencing

Slots into the existing EVM 8-phase audit-fix plan ([audit-fix-tracker.md](audit-fix-tracker.md)). Solana work runs in **parallel tracks**, not serial — EVM audit fix engineers and Anchor engineers are different people.

### Phase S0 — Audit kickoff + foundations cleanup (weeks 1-4)

- Engage audit firm for W1 pass 1 (`universe` / `episode` / `payment` as-is).
- Tighten `programs/payment` per any EVM PaymentRouter fixes already landed.
- Finalize IDL emission + indexer IDL decoder skeleton (W5).
- **Exit criteria**: audit pass 1 engagement signed, IDL decoder shipped.

### Phase S1 — Rights + licensing port (weeks 4-10)

Most-load-bearing parity work. Without these, original IP can be minted on Solana but not commercially distributed there.

- `programs/rights` (RightsRegistry port) — **✅ devnet 2026-05-15**. Program ID `NDpYpB49e3yzEcsPK1o34h9Zgrw9CPnVTnZLvDowL4m`. Config PDA `8k9xmQu5PonYDbhdPNfVuBRZxT179A65t4WnGXzeziZz` initialized. IDL published. Server SDK + EVM→Solana sync service shipped. EVM `submitSetRightsWithCreatorSig` caller in `likenessMarketplace.routes.ts` now fires `syncRightsHashToSolana` post-receipt (non-fatal, monotonic version). Anchor tests + smoke green. Init script: `apps/programs/scripts/init-rights.ts`.
- `programs/licensing` (ContentLicensing port, BUY only in v1) — **✅ devnet 2026-05-15**. Program ID `HTQhzknwF5mnnhHVSaF5ckRbeviwX2UuwayPNjiQybTp`. Config PDA `4keaYuQaM9Er6f2CQfuR84KG3dmm2ssCSZaDPumshwgH` initialized. Depends on `rights` crate (Cargo `path = "../rights"`) so registration gate validates `is_monetizable()` against the Rights PDA at the Anchor account-constraint level. RENT/LICENSE deal types deferred to S2 (Solana fee/lockup conventions diverge enough from EVM time-bound deals to warrant a separate design pass). Init script: `apps/programs/scripts/init-licensing.ts`.
- `programs/escrow` (Escrow port) — **❌ deferred, audit-gated**. EVM `ESCROW-03` (single-EOA `resolveDispute` dictatorship) is `[~] PARTIAL` in audit-fix-tracker — full fix (DAO appeal path) blocked on GOV-01 Safe/Timelock handover. Porting to Solana now would inherit the design-level vulnerability. Will unblock once ESCROW-03 lands as `[x] FIXED`.
- Cross-chain rights sync: EVM RightsRegistry events → Solana program via attestation
- UI: `/license/*` chain-aware
- **Exit criteria**: full rights cycle works on Solana devnet (issue → enforce → revoke), parity test suite green.

### Phase S2 — Marketplace + staking + governance (weeks 8-16, overlaps S1)

- `programs/canon-market` (CanonMarketplace port — all 4 P0 EVM CANON-01/02/03/04 are `[x] FIXED` per audit-fix-tracker; gate clear)
- `programs/staking` — **✅ devnet 2026-05-16** (v1: global tiers + per-universe stake/unstake; reward distribution deferred to v2 pending revenue-source wiring). Program ID `9EjnngPFpE3QaUgS3zspXwkLby2AnNwyC2UjPFL9zBqJ`. Weighted-average `staked_at` recomputation (STAKE-01 analog), 5-tier ladder (None/Bronze/Silver/Gold/Diamond) with default 1k/10k/100k/500k $LOAR thresholds, early-unstake penalty bps + lock period configurable by admin, `transfer_checked` for Token-2022 compatibility, two-step admin transfer.
- `programs/bonding_curve` — **✅ devnet 2026-05-16**. Program ID `seJzMSz9EkVYuNN9Nu3eJF3UgepeWzfgGvDnzrp2Uiw`. Linear curve `price = slope × tokens_sold`, slope derived so full supply raises exactly `graduation_lamports` SOL. u128 fixed-point with `PRECISION = 1e18`, integer-sqrt (Newton's method) for tokens-for-SOL. Per-tx max_buy + cumulative cap (CURVE-03 analog), 1% sell fee retained in reserve, deadline + slippage on both buy/sell (CURVE-01 analog). v1 deferrals: 48h halt timelock (CURVE-02; needs governance primitive), auto-graduation LP-seeding via Raydium/Meteora CPI (manual `mark_graduated()` emits event; LP creation is a v2 caller responsibility).
- Realms / SPL Governance wiring per universe
- Tensor / ME secondary-market SDK glue (no `programs/slop` — use native)
- **Exit criteria**: end-to-end universe lifecycle on Solana — create → bond → launch → canon → trade → govern.

### Phase S3 — Subscriptions, credits, splits, NFTs (weeks 14-20, overlaps S2)

- `programs/subscription` — **✅ devnet 2026-05-16**. Program ID `Hnnkuf933sv2rEucpCLaLbXxA1zPNxTNpUsp1WX9Fwbm`. v1: per-universe tier config (4 tiers: FREE/BASIC/PREMIUM/VIP with perks bitmask + credit bonus), SOL subscription + extension, integer-months `expires_at` accounting, creator auth read live from `Universe.creator` via cross-program account dependency on the `universe` crate. Tier upgrade/downgrade prorating (SUB-04 fix logic) defers to v2; auto-renew via Solana Pay recurring is a separate design pass.
- `programs/credit_manager` — **✅ devnet 2026-05-16**. Program ID `71rtSGzuBENiQa1cdmBbrN5F496CGQ46TnRGbGNpQ3xs`. v1: package CRUD + SOL/$LOAR purchase + platform-only spend + rate-limited grants (CREDIT-01 daily limit + CREDIT-06 per-user cumulative cap). Holder discount deferred to v2 (requires universe-token balance proof plumbing). Two-step admin AND platform key rotation (separate keys → tighter blast radius).
- `programs/split_router` — **✅ devnet 2026-05-15**. Program ID `7hcFnt2Tgzi1Sc3PDWqAQRFb6BoRmEtmoizBSLaYCGkr`. Config PDA `HCF7ZutJ79xa6kF8d3jdJqBxBt5Ces64Z4cddkiN9c5u`. SOL routing with platform-fee deduction + co-creator splits, 1-day cooldown (SPLIT-02 analog), 10000-bps total enforcement, last-recipient rounding-dust pattern, MAX_RECIPIENTS=10, MAX_FEE_BPS=5000. SPL token routing deferred to v2.
- Metaplex Core wiring for CharacterNFT / EntityNFT / IdentityNFT / StructuralDeed
- **Exit criteria**: payment/subscription/credit/NFT surfaces all chain-aware.

### Phase S4 — Audit pass 2 + Wormhole NTT (weeks 18-26)

- W1 pass 2: full program suite audit.
- W3: deploy NTT contracts + migrate.
- W4: Squads handover on all authorities.
- Bridge round-trip stress test + reconciliation alerting.
- **Exit criteria**: zero open audit P0/P1, NTT live for 30 days, Squads holds all authorities.

### Phase S5 — Mainnet-beta launch (weeks 24-28)

- W2: follow [solana-mainnet-runbook.md](solana-mainnet-runbook.md).
- Run mainnet-runbook-dryrun.ts read-only against mainnet.
- Soft launch: 7-day allowlist period, real cap on caps, monitor reconciliation drift hourly.
- Open registration.

**Total**: ~28 weeks (~7 months) parallel to EVM phases 3-8.

---

## 6. Resourcing

- **Anchor engineering**: 2-3 FTE for 6 months.
- **Frontend (chain-aware UI)**: 1 FTE for 4 months (overlaps S1-S3).
- **Indexer + DevOps**: 0.5 FTE for 6 months.
- **Audit**: ~$200k cash (two passes).
- **Mainnet on-chain costs**: ~$500 (deploys + trees + mint setup).
- **NTT setup**: ~$200 (deploys) + Wormhole integration time.

**Conservative budget**: $200k audit + ~$0.9M-$1.5M loaded eng cost depending on rates.

---

## 7. Risks + Open Questions

| Risk                                                                                     | Mitigation                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| EVM audit findings drift while Solana ports are in flight — ported version inherits bugs | Gate every Solana port on the EVM source contract being audit-clean (`[x] FIXED` in tracker).                                                |
| Realms / SPL Governance UX mismatch with EVM `UniverseGovernor`                          | Build a thin abstraction layer in [`apps/web/src/lib/governance.ts`](../apps/web/src/lib/governance.ts) (new). Same hook, different backend. |
| Rights state divergence between chains                                                   | RightsRegistry on EVM stays canonical. Solana program reads attestation, never writes rights authoritatively. Same model as IP.              |
| Mainnet-beta deploy before audit pass 2                                                  | Hard-gate: do not deploy ported programs to mainnet without W1 pass 2 clean.                                                                 |
| Wormhole NTT integration delays Phase S5                                                 | Custodial bridge stays live as fallback; NTT migration can land post-mainnet.                                                                |
| Squads v4 API breaking changes                                                           | Pin SDK version, run regression test on every bump.                                                                                          |
| $LOAR cross-chain supply drift if bridge fails                                           | Hourly reconciliation cron + pagerduty (already wired in `bridge-reconcile.ts`).                                                             |
| Audit firm availability (2-4 week lead time)                                             | Engage W1 pass 1 immediately, even before Phase S1 code lands.                                                                               |

### Decisions (resolved 2026-05-15)

1. **Audit tracker** → **Single tracker.** Solana findings land in [audit-fix-tracker.md](audit-fix-tracker.md) with `chain: solana` rows. One source of truth, same priority legend, same SLA. Avoids two trackers drifting.

2. **Governance** → **Realms / SPL Governance** (native, not custom port). Per the "don't reimplement what Solana ships natively" principle. Build a thin normalization layer in `apps/web/src/lib/governance.ts` so the UI hook is chain-agnostic. Accept that proposal/vote/execute UX will have minor differences vs OZ Governor — document the deltas, don't paper over them.

3. **Slop secondary market** → **Tensor + Magic Eden SDK glue** (native, not custom port). `SlopMarket.sol` is too much code for a port and SOL secondary-market UX is anchored on existing native marketplaces. Custom code only for royalty enforcement (Metaplex Core royalty plugin) and listing-creation glue.

4. **Mobile iOS Solana parity** → **One-release lag tolerated, capped.** The three majors (Phantom/Solflare/Backpack) ship via universal links today; that's the floor. Anything beyond is best-effort per release and not a launch blocker. If iOS coverage slips more than one release, escalate.

5. **Phase S5 cluster** → **Stage on public devnet for 30 days first.** Dry-run harness already exists. Stage cost is ~$500; cost of a mainnet rollback is much larger. Open registration only after 30 days of green reconciliation + zero P0/P1 incidents on stage.

---

## 8. Success Criteria

This PRD is complete when:

1. **Audit symmetry** — Anchor program audit reports filed, all P0/P1 findings closed, tracked in the same fix-tracker as EVM.
2. **Custody symmetry** — Squads holds program upgrade, mint, tree, and bridge authorities. No deployer EOA on critical paths.
3. **Surface symmetry** — every EVM-side commercial flow (mint → license → trade → stake → govern → bridge) works on Solana via the same UI, branching at the data layer only.
4. **Indexer symmetry** — every Solana program emits IDL-decoded events into Firestore with the same query shape as Ponder.
5. **SDK + agent symmetry** — `apps/mcp` exposes the same tool surface for both chains.
6. **Operational symmetry** — reconciliation alerts, drift detection, mainnet runbook dry-run all green.
7. **Trust upgrade** — Wormhole NTT live, custodial bridge demoted to fallback.

---

## 9. Out of Scope (this PRD)

- Adding chains beyond EVM + Solana.
- Migrating canonical IP off EVM.
- Net-new product features that don't exist on either chain today.
- Mainnet pricing / fee model changes (separate work item, depends on [tokenomics.md](tokenomics.md)).

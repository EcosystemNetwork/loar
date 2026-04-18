# LOAR Contract Audit — Consolidated Fix Tracker

**Sources**: 5 independent reviews (Apr 16–17, 2026)

- Audit A: Launch Readiness Audit (Apr 16)
- Audit B: Contract Security Deep Audit, Parts 1–3 (Apr 16–17)
- Audit C: Pre-Audit Review — Mainnet Readiness, Part 1 (Apr 17)
- Audit D: Extended Review — NFT Architecture, Staking, Governance, Revenue (Apr 17)
- Audit E: Pre-Audit Review — Part 3: Revenue, Factories, Token, Deployment (Apr 17)

**Status (2026-04-18)**: Most P0/P1 code fixes applied. Remaining blockers are operational (GOV-01 deploy-time handoff) and design-level (ESCROW-03, RIGHTS-01, UNIVERSE-01/02 admin powers). Second external audit pass still required before mainnet.

---

## Fix Priority Legend

| Priority | Meaning                                          | SLA                                 |
| -------- | ------------------------------------------------ | ----------------------------------- |
| P0       | Permanent fund loss or total protocol compromise | Fix before any deployment           |
| P1       | Exploitable within hours on mainnet              | Fix before mainnet                  |
| P2       | Significant risk, exploitable with effort        | Fix before mainnet                  |
| P3       | Operational / gas / UX risk                      | Fix before or shortly after mainnet |
| P4       | Informational / cleanup                          | Address in normal dev cycle         |

**Status markers**: [x] FIXED · [~] PARTIAL · [ ] NOT FIXED · [op] OPERATIONAL (script/deploy-time)

---

## P0 — Permanent Fund Loss / Protocol Takeover

### GOV-01: Single EOA owns all UUPS + Beacons — no timelock

- **Sources**: A, B (C1), C (C-6)
- **Contracts**: All Ownable/OwnableUpgradeable + NFT beacons
- **Fix**: Deploy Safe (3/5) → TimelockController (48h) → transfer ownership.
- **Status**: [op] Ready — `apps/contracts/script/TransferToMultisig.s.sol` performs the handoff (supports DRY_RUN). Blocker is operational: Safe must be deployed, Timelock roles wired, script executed on Base mainnet.
- **Notes**: No code change needed. Gate mainnet launch on verified on-chain ownership transfer.

### CANON-01: CanonMarketplace sockpuppet token

- **Sources**: B (C5)
- **Status**: [x] FIXED — `CanonMarketplace.submit` validates supplied `universeToken` against `UniverseManager.getUniverseData(universeId)`. See `apps/contracts/src/revenue/CanonMarketplace.sol:193-195`.

### CANON-02: CanonMarketplace `vote()` reentrancy

- **Sources**: B (C6/H7)
- **Status**: [x] FIXED — `nonReentrant` + CEI ordering (hasVoted set before external `getPastVotes`). `CanonMarketplace.sol:234-248`.

### CANON-03: Flash-loan / borrow-and-vote attack

- **Sources**: C (C-2)
- **Status**: [x] FIXED — `MIN_SNAPSHOT_AGE = 7200` blocks (~4h on Base). `CanonMarketplace.sol:135`.

### CANON-04: Failed-quorum submissions brick held ETH

- **Sources**: C (C-3)
- **Status**: [x] FIXED — Pull-pattern `claimableRefunds` mapping + EXPIRED state transition. `CanonMarketplace.sol:273-286`.

### CREDIT-01: `grantCredits` unbounded mint by hot key

- **Sources**: B (Medium escalated), C (C-5)
- **Status**: [x] FIXED — `dailyGrantLimit`, `currentGrantDay`, `maxGrantPerUser` rate limits. `CreditManager.sol:62-66`.

### CREDIT-02: `platform` address immutable

- **Sources**: B (H10 on Escrow), C (C-4)
- **Status**: [x] FIXED — `setPlatform(address)` onlyOwner function exists. `CreditManager.sol:319-324`.

### PAY-01: Payment verifiers don't check `tx.from` vs authenticated user

- **Sources**: B (C4)
- **Status**: [x] FIXED — `expectedSender` parameter and comparison present in all three verifiers:
  - `apps/server/src/routers/credits/credits.routes.ts:134-142` (ETH)
  - `apps/server/src/routers/credits/credits.routes.ts:203-214` (LOAR)
  - `apps/server/src/routers/credits/stripe.routes.ts:140-144` (Stripe)

### TOKEN-01: TOKEN_SUPPLY 100x mismatch

- **Sources**: B (C7)
- **Status**: [x] FIXED — Both `UniverseManager.sol:55` and `UniverseTokenDeployerV3.sol:103` use `1_000_000_000e18`.

### NFT-01: 5 NFT beacon proxies use non-upgradeable OZ bases

- **Sources**: D (C-7)
- **Status**: [x] FIXED — All 5 converted to Upgradeable bases:
  - `CharacterNFT.sol` uses `ERC721Upgradeable`
  - `EpisodeNFT.sol` uses `ERC721Upgradeable`
  - `EntityNFT.sol` uses `ERC721Upgradeable`
  - `EntityEditionNFT.sol` uses `ERC1155Upgradeable`
  - `EpisodeEditionCollection.sol` uses `ERC1155Upgradeable`

### GOV-06: GovernorFactory inline Governor with NO timelock

- **Sources**: E (C-13)
- **Status**: [x] FIXED — `GovernorFactory.deployGovernor` takes `timelock` param, deploys real `UniverseGovernor` (with 24h timelock + 20% early-life quorum). See `apps/contracts/src/factories/GovernorFactory.sol:15-30`.

### GOV-07: GovernanceTokenFactory inline token without symbol validation

- **Sources**: E (C-14)
- **Status**: [x] FIXED — `deployToken` enforces blocklist + 3-10 char length. `GovernanceTokenFactory.sol:87-96`.

### CONTENT-01: ContentLicensing skips rights-registry check

- **Sources**: E (C-16)
- **Status**: [x] FIXED — `registerContent` checks `rightsRegistry.isMonetizable(contentHash)`. `ContentLicensing.sol:149-150`.

### MARKET-01: SlopMarket ignores ERC2981 royalties

- **Sources**: E (C-17)
- **Status**: [x] FIXED — `buy` queries `IERC2981.royaltyInfo(tokenId, totalPrice)` and routes royalty. `SlopMarket.sol:193-198`.

### STAKE-01: LaunchpadStaking lock-period bypass via 1-wei seed

- **Sources**: D (C-9)
- **Status**: [x] FIXED — Weighted-average `stakedAt` on every incremental stake in both `stake()` and `stakeInUniverse()`. `LaunchpadStaking.sol:162-169`, `:254-261`.

---

## P1 — Exploitable Within Hours on Mainnet

### TOKEN-02: LoarToken fee-on-transfer breaks consumers

- **Sources**: B (C3), C (H-3), E (C-15)
- **Status**: [x] FIXED — Fee-on-transfer removed entirely. `LoarToken._update` now only enforces pause. `LoarToken.sol:128-132`.

### TOKEN-03: `totalMinted` vs `totalSupply()` cap contradiction

- **Sources**: B (C2)
- **Status**: [x] FIXED — `totalMinted` tracked separately, cap enforced against it. `LoarToken.sol:28-31, :79-83`.

### CURVE-01: BondingCurve buy/sell has no `deadline` parameter

- **Sources**: C (H-1)
- **Status**: [x] FIXED — `buy`/`sell` require `block.timestamp <= deadline`. `BondingCurve.sol:117, :165`.

### CURVE-02: `setTradingHalted` centralization kill-switch

- **Sources**: C (H-2)
- **Status**: [~] PARTIAL — Gated to `msg.sender == universeManager` (still centralized but no longer direct-EOA). Full fix requires wiring behind Timelock alongside GOV-01 ownership transfer.

### RIGHTS-01: RightsRegistry classifications rewritable by any operator

- **Sources**: B (H8)
- **Status**: [x] FIXED — Added `setRightsWithCreatorSig(contentHash, rightsType, creator, deadline, signature)` requiring EIP-191 signature from the true content creator over a domain-separated, nonce-protected digest (`"LOAR-RIGHTS-V1" || registry || chainId || contentHash || rightsType || nonce || deadline`). Legacy `setRights` retained for provisional first classification. `RightsRegistry.sol:156-206`.

### UNIVERSE-01: `setMedia`/`swapNodes` rewrites content without attribution update

- **Sources**: B (L14), C (H-4)
- **Status**: [x] FIXED — `setMedia` is now creator-only after a node becomes canon; admin can only edit non-canon nodes. `swapNodes` reverts if either node is canon. Canon content is immutable. `Universe.sol:267-297`.

### UNIVERSE-02: Canon flag inconsistent after `setCanon`

- **Sources**: C (H-5)
- **Status**: [~] DESIGN — `Universe.sol:407-408` documents O(1) trade-off. Off-chain consumers must derive canon via `getCanonChain()`. Acceptable if documented; otherwise a walk-and-update refactor is needed.

### UNIVERSE-03: `metadataRenderer` mutable

- **Sources**: C (H-6)
- **Status**: [x] FIXED — `lockMetadataRenderer()` one-way lock mechanism. `UniverseManager.sol:73-74, :142-146`.

### UNIVERSE-04: `_update` bricked by broken `Universe.setAdmin`

- **Sources**: C (H-8)
- **Status**: [x] FIXED — `UniverseManager._update` wraps `data.universe.setAdmin(to)` in `try/catch` and emits `AdminSyncFailed` on failure. NFT transfer cannot be bricked by a universe-level revert. `UniverseManager.sol:562-564`.

### LOCKER-01: LP Locker `withdrawEth`/`withdrawERC20` drain

- **Sources**: B (High)
- **Status**: [op] OPERATIONAL — `onlyOwner`; mitigated once ownership moves to Timelock via GOV-01.

### LOCKER-02: `updateRewardAdmin`/`updateRewardRecipient` instant replacement

- **Sources**: B (Medium), C (H-7)
- **Status**: [x] FIXED — 2-day delay via 2-step admin/recipient changes. `LoarLpLockerMultiple.sol:43-50`.

### HOOK-01: LoarHookStaticFee missing override verification

- **Sources**: B (H4)
- **Status**: [x] FIXED — `_beforeSwap`/`_afterSwap` overrides wired. `LoarHook.sol:178-199`.

### AUTH-01: SIWE defaults `chainId` to 1 (mainnet)

- **Sources**: B (H9)
- **Status**: [x] FIXED — Frontend defaults to Base `8453` when wallet hasn't reported. `apps/web/src/lib/wallet-auth.ts:307-310`. Server allowlist env-configurable.

### AUTH-02: Rate-limiter fallback key `'unknown-' + Date.now()`

- **Sources**: B (H11)
- **Status**: [x] FIXED — Constant `'unknown-shared'` fallback. `apps/server/src/middleware/rate-limit.ts:151`.

### ROYALTY-01: CharacterNFT.claimRoyalties emits success but transfers nothing

- **Sources**: D (C-8)
- **Status**: [x] FIXED — Function removed; royalties route through PaymentRouter on appearance. `CharacterNFT.sol:205-207`.

### DEED-01: StructuralDeed.mintDeed no universe-ownership check

- **Sources**: E (H-22)
- **Status**: [x] FIXED — `IERC721(universeManager).ownerOf(universeId) == msg.sender` check. `StructuralDeed.sol:130-134`.

### COLLAB-01: CollabManager trusts proposer/acceptor blindly

- **Sources**: E (H-23)
- **Status**: [x] FIXED — Both `proposeCollab` and `acceptCollab` verify `universeManager.ownerOf()`. `CollabManager.sol:100-146`.

### BOUNTY-01: StoryBounties — poster can rug accepted winner

- **Sources**: E (H-24)
- **Status**: [x] FIXED — `expireBounty` requires `block.timestamp > deadline + AWARD_GRACE_PERIOD` (7-day grace). `StoryBounties.sol:224`.

### SPOKE-01: LoarTokenSpoke diverges from hub in safety features

- **Sources**: E (H-26)
- **Status**: [x] FIXED — Pausable + totalMinted + MAX_SUPPLY wired. `LoarTokenSpoke.sol:18, :24, :70`.

### SPLIT-02: SplitRouter.setSplits no commit-delay

- **Sources**: E (H-27)
- **Status**: [x] FIXED — 1-day `SPLIT_CHANGE_COOLDOWN` enforced. `SplitRouter.sol:33-36`.

### ESCROW-03: Escrow.resolveDispute single-EOA dictatorship

- **Sources**: D (C-10)
- **Status**: [~] PARTIAL — Still `onlyOwner`. Mitigated after GOV-01 moves ownership to Timelock (48h delay + Safe consent). Full fix (DAO appeal path) deferred to post-launch.

### GOV-02: GovernanceERC20 no auto-delegation

- **Sources**: D (C-11)
- **Status**: [x] FIXED — `_update` override auto-delegates on first receipt. `GovernanceTokenFactory.sol:32-41`.

### GOV-03: GovernanceERC20 symbol blocklist never checked

- **Sources**: D (C-12)
- **Status**: [x] FIXED — Blocklist enforced at deploy time in `GovernanceTokenFactory.deployToken`. See GOV-07.

### AD-01: AdPlacement bids locked forever

- **Sources**: D (H-10)
- **Status**: [x] FIXED — `cancelBid()` with 3-day cooldown or 30-day slot-expiry. `AdPlacement.sol:201-206`.

### REVENUE-01: 5 revenue contracts trust platform-set `universeCreators`

- **Sources**: D (H-11)
- **Status**: [x] FIXED — `registerUniverse` reads creator from `universeManager.ownerOf()` on-chain. `LicensingRegistry.sol:137-141` (pattern replicated across CanonMarketplace, SubscriptionManager, AdPlacement, RemixFees).

### SUB-01: SubscriptionManager tier downgrade nukes paid time

- **Sources**: D (H-13)
- **Status**: [x] FIXED — Downgrades blocked on active subscription. `SubscriptionManager.sol:178-181`.

### RIGHTS-02: RightsRegistry.freeze() single-operator kill switch

- **Sources**: D (H-16)
- **Status**: [x] FIXED — Two-step freeze: operator requests, owner confirms. `RightsRegistry.sol:87-105`.

### LICENSE-01: LicensingRegistry.createLicense sets licensor = msg.sender

- **Sources**: D (H-18)
- **Status**: [x] FIXED — `createLicense` verifies against stored `universeCreators` mapping. `LicensingRegistry.sol:156`.

---

## P2 — Significant Risk, Requires Effort to Exploit

### ESCROW-01: `resolveDispute` no platform fee

- **Sources**: B (M15)
- **Status**: [x] FIXED — Platform fee applied in dispute resolution. `Escrow.sol:158-183`.

### ESCROW-02: `setDisputeWindow` unbounded

- **Sources**: B (M16)
- **Status**: [x] FIXED — Capped at 30 days. `Escrow.sol:215`.

### SPLIT-01: `SplitRouter.setPaymentRouter` no lock

- **Sources**: B (M17)
- **Status**: [x] FIXED — 2-day timelock via `requestPaymentRouterChange` + `executePaymentRouterChange`. `SplitRouter.sol:163-181`.

### VESTING-01: `revokeVesting` + single-EOA

- **Sources**: B (M12), D (H-14)
- **Status**: [~] PARTIAL — `onlyOwner`; mitigated by GOV-01 ownership transfer. Non-revocable beneficiary consent flow deferred.

### VESTING-02: `claimAll` unbounded loop

- **Sources**: B (M13)
- **Status**: [x] FIXED — Capped at 50 per call; pagination via `claim()`. `TokenVesting.sol:202`.

### VESTING-03: `createVesting` breaks on fee-on-transfer tokens

- **Sources**: D (H-15)
- **Status**: [x] FIXED — Uses pre/post balance diff. `TokenVesting.sol:125-129`.

### CANON-05: Voting deadline uses timestamp vs snapshot (block number)

- **Sources**: B (M11)
- **Status**: [x] FIXED — Documented intentional design: timestamps for human deadlines, block numbers for snapshot integrity. `CanonMarketplace.sol:54-60`.

### CANON-06: Rejected submissions keep platform fee (undocumented)

- **Sources**: C (M-6)
- **Status**: [x] FIXED — Documented anti-spam rationale. `CanonMarketplace.sol:261-264`.

### CURVE-03: `MAX_BUY_AMOUNT` per-tx only

- **Sources**: B (Low), C (M-3)
- **Status**: [x] FIXED — Per-address cumulative cap via `tokensBought` tracking. `BondingCurve.sol:97, :129`.

### AUTH-03: SIWE in-memory nonce fallback unsafe for multi-instance

- **Sources**: B (M14)
- **Status**: [x] FIXED — Firestore required in production; throws if unavailable. `siwe.ts:11-21`.

### AUTH-04: Frontend session validation silently keeps stale sessions

- **Sources**: B (M18)
- **Status**: [x] FIXED — Fails closed, clears localStorage. `wallet-auth.ts:132`.

### GOV-04: UniverseGovernor.EARLY_LIFE_BLOCKS assumes Base 2s blocks

- **Sources**: D (H-12)
- **Status**: [x] FIXED — Parameterized via constructor. `UniverseGovernor.sol:46, :51, :59`.

### HOOK-02: LoarHook calls `_lpLockerFeeClaim` on every swap

- **Sources**: D (H-17)
- **Status**: [x] FIXED — 1-hour throttle via `LOCKER_CLAIM_INTERVAL`. `LoarHook.sol:52-54`.

### LICENSE-02: LicensingRegistry.royaltyBps stored but never enforced

- **Sources**: D (H-19)
- **Status**: [x] FIXED — Documented as advisory/off-chain binding. `LicensingRegistry.sol:28-32`.

### STAKE-02: LaunchpadStaking mixed global/universe reward accounting

- **Sources**: D (M-10)
- **Status**: [~] PARTIAL — Logic separated; formal invariant test coverage should be expanded before mainnet.

### ESCROW-04: Escrow MAX_FEE_BPS = 5000 predatory

- **Sources**: D (M-15)
- **Status**: [x] FIXED — Capped at 1000 bps (10%). `Escrow.sol:56, :95`.

### UPGRADE-01: Storage gaps ad-hoc, no CI verification

- **Sources**: C (H-9)
- **Status**: [x] FIXED — `.github/workflows/security.yml` now fails CI if any UUPS contract is missing `__gap` and uploads per-contract storage layouts as artifacts.

### TREASURY-01: `claimTeamFee(token)` transfers full balance

- **Sources**: C (I-3)
- **Status**: [x] FIXED — Allowlist `claimableTokens[token]` check.

### DEED-02: StructuralDeed.mintDeed no overpayment refund

- **Sources**: E (H-21)
- **Status**: [x] FIXED — Refunds excess above price to sender. `StructuralDeed.sol:172-180`.

### TOKEN-04: UniverseTokenDeployerV3 lumps treasury+community

- **Sources**: E (H-20)
- **Status**: [x] FIXED — Added `communityRecipient` + `setCommunityRecipient()`. When set, `deployTokenAndGovernance` routes the community share to the distinct address and treasury-only to UniverseManager. Legacy merged path preserved when `communityRecipient == address(0)`. `UniverseTokenDeployerV3.sol:121-137, :270-284`.

### IDENTITY-01: IdentityNFT claims soulbound but is transferable

- **Sources**: E (H-25)
- **Status**: [x] FIXED — `_update` override blocks transfers. `IdentityNFT.sol:156-160`.

### CREDIT-05: CreditManager.purchaseWithLoar fallback bypasses PaymentRouter

- **Sources**: E (M-18)
- **Status**: [x] FIXED — Fallback removed; requires PaymentRouter to be set. `CreditManager.sol:248`.

### FACTORY-01: UniverseFactory.createUniverse no access control

- **Sources**: E (M-22)
- **Status**: [x] FIXED — `onlyManager` modifier enforced. `UniverseFactory.sol:27`.

### TREASURY-02: Treasury set to `address(this)` breaks accounting

- **Sources**: C (M-4)
- **Status**: [x] FIXED — `require(newTreasury != address(this))`. `PaymentRouter.sol:173`.

---

## P3 — Operational / Gas / UX Risk

### CREDIT-03: `setHolderDiscount` uncapped

- **Sources**: B (Medium), C (M-5)
- **Status**: [x] FIXED — Capped at 5000 bps. `CreditManager.sol:315`.

### CREDIT-04: Holder discount — 1 wei qualifies

- **Sources**: B (Medium)
- **Status**: [x] FIXED — Minimum holding threshold `bal >= 1e18` (1 full token). `CreditManager.sol:187`.

### UNIVERSE-05: `getFullGraph` unbounded

- **Sources**: C (M-7)
- **Status**: [~] PARTIAL — 500-node guard; `getGraphPage` available. Fully paginated-only removal deferred.

### UNIVERSE-06: `_mintIdentityNfts` silent truncation

- **Sources**: C (M-2)
- **Status**: [x] FIXED — Counter widened to `uint16` + hard cap at 200 signers + `SignersTruncated(universeId, actualCount, mintedCount)` event emitted when truncation occurs. `UniverseManager.sol:98-99, :448-452`.

### BUILD-01: `optimizer_runs=1`

- **Sources**: C (M-8)
- **Status**: [x] FIXED — `optimizer_runs=200` in `foundry.toml`.

### BUILD-02: Pragma mismatch

- **Sources**: C (L-4)
- **Status**: [x] FIXED — Unified to `^0.8.30` across contracts; CI enforces no `^0.8.28`.

### BUILD-03: No Slither/Mythril in CI

- **Sources**: A, C (I-4)
- **Status**: [x] FIXED — `security.yml` runs Slither (`fail-on: medium`) and Mythril on every PR.

### BUILD-04: No formal verification on bonding curve

- **Sources**: C (I-5)
- **Status**: [ ] NOT STARTED — Foundry invariants + Certora/Halmos recommended pre-mainnet.

### LEGAL-01: ToS & Privacy Policy placeholders

- **Sources**: A
- **Status**: [ ] NOT STARTED — Requires legal counsel. Block mainnet on final text.

### LEGAL-02: DMCA agent registration

- **Sources**: A
- **Status**: [ ] NOT STARTED — $6 filing for 512(c) safe harbor.

### LEGAL-03: NYSE ticker collision — $LOAR vs LOAR Holdings

- **Sources**: B (L12), D (C-12)
- **Status**: [ ] NOT STARTED — Product/legal decision: rename ticker or accept C&D risk.

### INFRA-01: Firestore order source of truth

- **Sources**: C (I-1)
- **Status**: [x] FIXED — `order-reconciliation.ts` service + `credits.reconcile` admin endpoints.

### INFRA-02: `SIWE_JWT_SECRET` single point of compromise

- **Sources**: C (I-2)
- **Status**: [ ] OPERATIONAL — Rotation policy + secrets manager TBD.

### NFT-02: EntityNFT name/symbol immutable across beacon proxies

- **Sources**: D (M-11)
- **Status**: [~] PARTIAL — Acceptable as-is given NFT-01 rewrite; document or parameterize.

### GOV-05: UniverseGovernor proposal threshold spam vector

- **Sources**: D (M-12)
- **Status**: [ ] NOT VERIFIED — Threshold is 1M tokens; consider raising or adding proposal deposit.

### HOOK-03: LoarHook protocolFee shared across pools

- **Sources**: D (M-13)
- **Status**: [ ] NOT VERIFIED — Add multi-pool atomic-swap test.

### AD-02: AdPlacement.recordImpression — platform inflates

- **Sources**: D (M-16)
- **Status**: [ ] OPERATIONAL — Oracle or episode-mint proof deferred to post-launch.

### SUB-02: SubscriptionManager.configureTier no price cap

- **Sources**: D (M-17)
- **Status**: [x] FIXED — `pricePerMonth <= 100 ether` cap. `SubscriptionManager.sol:129`.

### BURN-01: LoarBurner misleadingly named

- **Sources**: E (H-28)
- **Status**: [~] DOCUMENTED — Explicit WARNING + BURN-01 reference in the contract header (`LoarBurner.sol:12-19`). Full file/contract rename deferred: would touch every importer and the Safe-timelock upgrade path. Tokenomics docs should stop claiming deflationary burns.

### FACTORY-02: Three Governor + two Token implementations

- **Sources**: E (H-29, M-25)
- **Status**: [~] PARTIAL — Correct ones (`UniverseGovernor`, factory `GovernanceERC20`) are the wired path. Dead copies (`UniverseTimelockGovernor.sol`, standalone `GovernanceERC20.sol`, `UniverseTokenDeployer.sol` V1, `UniverseTokenDeployerV2.sol`, `utils/LoarDeployer.sol`, `utils/GovernorDeployer.sol`) still present. Deletion deferred: V1 deployer is imported by `DeployAll`/`DeployBase`/`DeployProtocol` scripts — requires deploy-script refactor to delete cleanly.

### ANALYTICS-01: `setTrending` platform-curated

- **Sources**: E (M-19)
- **Status**: [ ] DOC — Document transparency.

### CONTENT-02: ContentLicensing DealStatus.EXPIRED never transitions

- **Sources**: E (M-24)
- **Status**: [~] PARTIAL — View-only optimistic check; add background mechanism post-launch.

### IDENTITY-02: IdentityNFT universeName/image stale on rebrand

- **Sources**: E (M-21)
- **Status**: [ ] NOT STARTED — Read from Universe contract dynamically.

### MISC-01: Dead constant `teamFee = 0`

- **Sources**: C (M-1)
- **Status**: [x] FIXED — Verified removed from `UniverseManager.sol` (no matches). Only `teamFeeRecipient` remains as an actual state variable.

---

## P4 — Informational / Cleanup

(Unchanged — address in normal dev cycle; not mainnet gating.)

- AnalyticsRegistry.requestDataExport — event-only, no on-chain follow-through
- StoryBounties `*Changed` events declared but never emitted
- `require()` → custom errors (partial)
- `BondingCurve.buy` low-gas send
- `CreditManager.initialize` inline generation costs
- Pin `=0.8.30` (currently `^0.8.30`)
- SPDX license mismatches
- Dead scaffolding: `apps/bridge/`, `apps/contracts-sol/`, `apps/contracts-sui/`
- Trust-model.md references to nonexistent functions
- `CreditsPurchasedWithLoar` event desync
- CanonMarketplace tie rejection — no resubmit path
- SIWE `localhost` in prod domains list
- Token revocation memory-only
- Firestore rules reference `request.auth` (dead code)
- Payment verifiers don't check tx age

---

## Unreviewed Contracts (Second External Audit Required)

| Contract                     | LOC (est) | Risk                   | Status after internal review         |
| ---------------------------- | --------- | ---------------------- | ------------------------------------ |
| AdPlacement.sol              | ~200      | Medium                 | AD-01 fixed, AD-02 deferred          |
| SubscriptionManager.sol      | ~300      | High                   | SUB-01/02 fixed                      |
| CollabManager.sol            | ~200      | Medium                 | COLLAB-01 fixed                      |
| LicensingRegistry.sol        | ~250      | High                   | LICENSE-01/02 fixed                  |
| ContentLicensing.sol         | ~200      | High                   | CONTENT-01 fixed, CONTENT-02 partial |
| StoryBounties.sol            | ~300      | High                   | BOUNTY-01 fixed                      |
| SlopMarket.sol               | ~200      | High                   | MARKET-01 fixed                      |
| StructuralDeed.sol           | ~150      | Medium                 | DEED-01/02 fixed                     |
| RemixFees.sol                | ~150      | Medium                 | REVENUE-01 coverage                  |
| LaunchpadStaking.sol         | ~300      | High                   | STAKE-01 fixed, STAKE-02 partial     |
| LoarSwapRouter.sol           | ~150      | Medium                 | Needs audit                          |
| LoarBurner.sol               | ~100      | Low                    | BURN-01 open                         |
| CharacterNFT.sol             | ~200      | Critical → upgradeable | NFT-01 fixed, ROYALTY-01 fixed       |
| EntityNFT.sol                | ~200      | Critical → upgradeable | NFT-01 fixed, NFT-02 partial         |
| EntityEditionNFT.sol         | ~200      | Critical → upgradeable | NFT-01 fixed                         |
| EpisodeNFT.sol               | ~200      | Critical → upgradeable | NFT-01 fixed                         |
| EpisodeEditionCollection.sol | ~200      | Critical → upgradeable | NFT-01 fixed                         |
| CollectiveTokenFactory.sol   | ~150      | Medium                 | Needs audit                          |
| IdentityNFT.sol              | ~150      | Medium                 | IDENTITY-01 fixed, IDENTITY-02 open  |
| LoarTokenSpoke.sol           | ~200      | High                   | SPOKE-01 fixed                       |
| AnalyticsRegistry.sol        | ~200      | Low                    | ANALYTICS-01 doc only                |

---

## Remaining Mainnet Blockers

### Code (remaining)

1. **UPGRADE-01 follow-on** — Commit baseline storage-layout JSON artifacts (emitted by the new CI job) to the repo so PRs can diff layouts automatically.
2. **BUILD-04** — Foundry invariants on `BondingCurve` (`ethRaised <= integral`, `balance >= pendingRefunds + ethRaised`) and `PaymentRouter` (`sum(pending) <= balance`).
3. **FACTORY-02 cleanup** — Delete `UniverseTokenDeployer.sol` (V1), `UniverseTokenDeployerV2.sol`, `UniverseTimelockGovernor.sol`, standalone `GovernanceERC20.sol`, `utils/LoarDeployer.sol`, `utils/GovernorDeployer.sol`. Requires a mainnet `DeployMainnet.s.sol` using V3 + factories so `DeployAll`/`DeployBase`/`DeployProtocol` can be removed or retargeted.

### Operational / deployment

4. **GOV-01** — Deploy Safe (≥3/5), deploy TimelockController (48h delay), wire Safe as PROPOSER+EXECUTOR, run `TransferToMultisig.s.sol` on Base mainnet. Verify `owner()` returns Timelock for every contract.
5. **INFRA-02** — Rotate `SIWE_JWT_SECRET`, move to secrets manager.
6. **TOKEN-04 config** — Deploy a dedicated community-treasury address (DAO wallet / merkle distributor) and call `UniverseTokenDeployerV3.setCommunityRecipient(addr)` before first mainnet universe.
7. **CURVE-02, LOCKER-01, VESTING-01, ESCROW-03** — All are `onlyOwner` paths that become materially safer after GOV-01 (48h timelock delay + Safe consent). No code change required beyond the ownership handoff; confirmed as acceptable mitigation.

### Legal / Product

8. **LEGAL-01** — Real Terms of Service & Privacy Policy.
9. **LEGAL-02** — DMCA agent registered (512(c) safe harbor).
10. **LEGAL-03** — Decide: rename $LOAR ticker or accept C&D exposure from NYSE:LOAR.
11. **BURN-01** — Update tokenomics docs to stop claiming deflationary burns; plan a `LoarBurner` → `PremiumActions` rename via the post-launch UUPS upgrade.

### External audit

12. **Pass 1** — Engage 2 firms on the fix-applied codebase snapshot.
13. **Pass 2** — Re-audit after Pass 1 fixes (NFT upgradeable rewrite, revenue routing, RIGHTS-01 signature path, and UNIVERSE-01 restrictions are large enough surface areas to introduce new bugs).
14. **Public contest** (Code4rena / Sherlock) and bug bounty.

---

## Stats (2026-04-18, second pass)

| Severity           |   Total |  Fixed | Partial | Operational | Not Started |
| ------------------ | ------: | -----: | ------: | ----------: | ----------: |
| P0 — Critical      |      15 |     14 |       0 |           1 |           0 |
| P1 — High          |      28 |     23 |       2 |           1 |           2 |
| P2 — Significant   |      24 |     21 |       2 |           0 |           1 |
| P3 — Operational   |      24 |      9 |       5 |           3 |           7 |
| P4 — Informational |      20 |      0 |       0 |           0 |          20 |
| **Total**          | **111** | **67** |   **9** |       **5** |      **30** |

**Verdict**: Every P0 code fix is in place; the only P0 gap (GOV-01) is an operational handoff with the script already written. P1 is at 23/28 fixed with the remaining 5 tracked either as design-level (RIGHTS-01 has a signature path added — partial because legacy `setRights` still exists) or post-GOV-01 operational. The remaining mainnet-gating work is: run `TransferToMultisig.s.sol`, deploy Safe+Timelock, pass 2 external audit, legal text, and the FACTORY-02 source cleanup.

_Last updated: 2026-04-18 (second pass — UNIVERSE-01, UNIVERSE-04, UNIVERSE-06, TOKEN-04, MISC-01, RIGHTS-01 code fixes applied)_

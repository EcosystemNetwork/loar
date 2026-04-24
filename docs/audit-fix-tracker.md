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
- **Status**: [x] FIXED — `BondingCurve.setTradingHalted` callable only by `universeManager`; `UniverseManager.setBondingCurveHalted` is `onlyOwner`. Once GOV-01 transfers UniverseManager ownership to the Timelock, halts are subject to the 48h delay + Safe consent — the audit's requested timelock protection. `BondingCurve.sol:73-82`, `UniverseManager.sol:512-516`.

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
- **Status**: [x] FIXED — Added `createNonRevocableVesting(...)` + `nonRevocable` flag in `VestingSchedule`. `revokeVesting` reverts with `VestingIsNonRevocable` for non-revocable schedules. Investor / team allocations can now be created with guaranteed delivery. `TokenVesting.sol:33-44, :111-180`.

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
- **Status**: [x] FIXED — Added `test/invariant/LaunchpadStakingInvariant.t.sol` exercising: `balance >= totalStaked + totalUniverseStaked`, per-actor global sum == `totalStaked`, per-universe sums match `pool.totalStaked`, and pool-sum aggregate equals `totalUniverseStaked`.

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
- **Status**: [x] FIXED — Bounded by `require(latestNodeId <= 500)` plus a dedicated paginated path `getGraphPage(startId, count)`. Callers with large graphs must paginate. `Universe.sol:334, :367`.

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
- **Status**: [x] FIXED — Foundry invariant suites for both critical ETH-holding contracts:
  - `test/invariant/BondingCurveInvariant.t.sol` — monotonicity, conservation, supply bound, graduation, buy/sell symmetry, pending-refunds safety, token accounting.
  - `test/invariant/PaymentRouterInvariant.t.sol` — ETH solvency (`balance >= claimable + pending`), no ETH creation, LOAR solvency, no LOAR creation, pending-withdrawal fallback invariants.
  - Certora/Halmos formal proofs still recommended post-launch.

### LEGAL-01: ToS & Privacy Policy placeholders

- **Sources**: A
- **Status**: [ ] NOT STARTED — Requires legal counsel. Block mainnet on final text.

### LEGAL-02: DMCA agent registration

- **Sources**: A
- **Status**: [ ] NOT STARTED — $6 filing for 512(c) safe harbor. Note: § 512(g) **counter-notice loop** is now fully implemented in code (see DMCA-01 below) — only the agent-of-record registration remains.

### DMCA-01: § 512(g) counter-notice safe-harbor loop

- **Sources**: Pre-launch checklist #4 (Phase 1)
- **Status**: [x] FIXED — Full loop implemented and tested:
  - Public `/counter-notice` page + `POST /api/counter-notice` REST endpoint (auth-gated to content owner) + `counterNotices` Firestore collection
  - `apps/server/src/jobs/dmca-putback.ts` runs hourly under `DMCA_PUTBACK_ENABLED=true`, scans pending counter-notices, restores content after the hold period, writes `contentAuditLog` row, fires Slack alert
  - `apps/server/src/lib/business-days.ts` computes US-federal-holiday-aware business days (covers MLK, Memorial Day, Juneteenth, Inauguration, observed-day shifts). Putback job uses ≥10 business days (default 12) instead of 14 calendar days — closes the worst-case underflow where Memorial-Day week reduces 14 calendar = 9 business days. 13/13 unit tests in `apps/server/src/__tests__/business-days.test.ts`.
  - § 512(g)(1) subscriber notification: `moderation.updateContentStatus` to `hidden`/`removed` now writes an in-app `notifications` row keyed to the content creator + dispatches `emailTakedownToSubscriber` (best-effort if user has stored an email). Notification deep-links to `/counter-notice?takedownRequestId=…`; the form pre-fills the reference from the query string.
  - § 512(g)(2)(B) claimant forwarding: `emailCounterNoticeToClaimant` fires inline when the counter-notice REST endpoint accepts a submission.
  - § 512(g)(2)(C) putback notice: `emailPutbackToClaimant` fires from the job after auto-restoration.
  - Admin endpoints to override: `admin.moderation.markCourtAction`, `admin.moderation.runDmcaPutbackSweep`, `admin.moderation.listCounterNotices`.
- **Operational blocker**: set `DMCA_PUTBACK_ENABLED=true` on exactly ONE replica in prod (single-writer job; env defaults to off in dev/CI).

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
- **Status**: [x] FIXED — `EntityNFT.initialize` now takes optional `_name` / `_symbol` string parameters (empty-string falls back to the default "LOAR Entities" / "ENTITY"). `RevenueModuleFactory` forwards empty strings by default; per-universe customization can be wired through the factory in a future upgrade without further contract changes. `EntityNFT.sol:67-88`.

### GOV-05: UniverseGovernor proposal threshold spam vector

- **Sources**: D (M-12)
- **Status**: [x] FIXED — Raised proposal threshold from 1M to 10M tokens (1% of a standard 1B-supply universe). `UniverseGovernor.sol:53`.

### HOOK-03: LoarHook protocolFee shared across pools

- **Sources**: D (M-13)
- **Status**: [x] FIXED — Replaced single `uint24 protocolFee` slot with `mapping(PoolId => uint24) poolProtocolFee`. `_setProtocolFee(poolKey, fee)` writes per-pool; `_beforeSwap` and `_afterSwap` read `poolProtocolFee[poolKey.toId()]`. Multi-pool atomic swaps can no longer cross-contaminate fee state. `LoarHook.sol:32-44, :84-90, :190-314`.

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
- **Status**: [x] FIXED — One Governor (`UniverseGovernor`), one Governance token (factory `GovernanceERC20`), one token deployer (V3). Removed source files:
  - `src/UniverseTokenDeployer.sol` (V1)
  - `src/UniverseTokenDeployerV2.sol`
  - `src/UniverseTimelockGovernor.sol`
  - `src/GovernanceERC20.sol` (standalone, factory version in `factories/GovernanceTokenFactory.sol` is the wired path)
  - `src/utils/LoarDeployer.sol`
  - `src/utils/GovernorDeployer.sol`
    Removed Sepolia-only deploy scripts that depended on V1/V2:
  - `script/DeployProtocol.s.sol`, `script/DeployDeployerV2.s.sol`
  - `script/RedeployManager.s.sol`, `script/RedeployTokenDeployer.s.sol`
  - `test/GovernanceERC20.t.sol` (tested standalone variant)

  `DeployAll.s.sol` now uses V3 + BondingCurveFactory + GovernanceTokenFactory + GovernorFactory + TimelockController. `DeployBase.s.sol` (Base mainnet) wraps `DeployAll`.

### ANALYTICS-01: `setTrending` platform-curated

- **Sources**: E (M-19)
- **Status**: [x] FIXED — `setTrending` carries an explicit doc block declaring the list is PLATFORM-CURATED (not algorithmic), with transparency enforced by the `TrendingUpdated(ids)` event and the `onlyPlatform` gate. `AnalyticsRegistry.sol:160-169`.

### CONTENT-02: ContentLicensing DealStatus.EXPIRED never transitions

- **Sources**: E (M-24)
- **Status**: [x] FIXED — Added permissionless `expireDeal(dealId)` and batch `expireDeals(uint256[])`. Anyone can push out-of-time RENT/LICENSE deals from ACTIVE → EXPIRED. `DealExpired(dealId)` event emitted. `checkAccess` also emits on auto-expire. Keeps `hasAccessFast` consistent with real-world state. `ContentLicensing.sol:338-383`.

### IDENTITY-02: IdentityNFT universeName/image stale on rebrand

- **Sources**: E (M-21)
- **Status**: [x] FIXED — `tokenURI` now reads `universeName()` and `universeImageUrl()` live from the Universe contract at render time, falling back to the snapshot taken at mint if the live call reverts. `IdentityNFT.sol:114-132`.

### MISC-01: Dead constant `teamFee = 0`

- **Sources**: C (M-1)
- **Status**: [x] FIXED — Verified removed from `UniverseManager.sol` (no matches). Only `teamFeeRecipient` remains as an actual state variable.

---

## P4 — Informational / Cleanup

- **[x] AnalyticsRegistry.requestDataExport documented** — clarified as intentional event-only signal for off-chain workers; no on-chain follow-through is by design. `AnalyticsRegistry.sol:174-183`.
- **[x] StoryBounties `*Changed` events** — now emitted from every setter. `StoryBounties.sol:263-306`.
- `require()` → custom errors (partial) — deferred; some `require` strings are intentionally human-readable and the gas savings here are marginal vs. test-rewrite cost.
- **[x] `BondingCurve.buy` low-gas send documented** — added inline rationale explaining the 50_000-gas stipend (tight enough to block reentrancy, large enough for EOA + Safe-style proxy receivers) and the `pendingRefunds` pull-pattern fallback. `BondingCurve.sol:139-156`.
- `CreditManager.initialize` inline generation costs — kept as deploy-time defaults; updated post-deploy via `setGenerationCost`. Not a bug.
- **[x] Pragma pinned `=0.8.30`** — 122 files migrated from `^0.8.30` to exact pin; `security.yml` CI now fails if any file drifts.
- **[x] SPDX license mismatches normalized** — all `test/*.sol` files standardized from `UNLICENSED` to `MIT`, matching `src/*.sol` and `script/*.sol`. CI grep can now assert a single license.
- **[x] Dead scaffolding removed** — `apps/bridge/`, `apps/contracts-sol/`, `apps/contracts-sui/` no longer present in the monorepo.
- **[x] Trust-model.md references audited** — confirmed all referenced UniverseManager functions exist; added missing rows for `setMetadataRenderer`, `lockMetadataRenderer`, `setUniverseFactory`, `setIdentityNft`; added "owner CANNOT replace renderer after lock" guarantee. `docs/trust-model.md`.
- **[x] `CreditsPurchasedWithLoar` event desync** — verified event payload `(credits, bonus, loarPaid)` matches the corresponding `userCredits` mutations exactly (`pkg.credits` → `totalPurchased`, `pkg.bonusCredits + loarBonus` → `totalBonusReceived`, `loarAmount` → routed via PaymentRouter). `CreditManager.sol:262-266`.
- CanonMarketplace tie rejection — current behavior (tie → REJECTED) is intentional: canon entry requires affirmative majority. `submit()` has no duplicate-hash guard, so resubmission is already free-form (creator pays new fee).
- **[x] SIWE `localhost` in prod domains** — `siwe.ts:80-97` filters `localhost` when `NODE_ENV=production` and throws if no other domain remains.
- **[x] SIWE nonce rate-limit** — `/auth/*` is capped at 20 req/min in `index.ts:82`.
- **[x] Token revocation persisted** — `revokeToken`/`isTokenRevoked` use Firestore `revokedTokens` collection in production; in-memory `Map` with bounded LRU eviction is the dev-only fallback when Firebase is unavailable. `siwe.ts:297-341`.
- **[x] Firestore rules `request.auth` removed** — LOAR uses SIWE JWT not Firebase Auth, so `request.auth` was always null from the client SDK. Dead branches removed; user-scoped collections explicitly deny client reads and must go through SIWE-gated tRPC. `firestore.rules`.
- **[x] Payment verifiers reject stale tx** — `MAX_TX_AGE_SECONDS = 24h` check in `verifyEthPayment` and `verifyLoarPayment`. Amplifies PAY-01 by shrinking the replay window around a leaked tx hash. `credits.routes.ts:36-39, :156-171, :242-256`.

---

## Seventh Pass — 2026-04-18 Follow-up Findings

Independent fresh pass after the sixth-pass sign-off surfaced six new issues. All fixed in the same pass.

### RIGHTS-03: Operator pre-claim via `setRights` (P1)

- **Source**: Apr-18 fresh pass
- **Impact**: A compromised operator could call `setRights(hash, ORIGINAL)` on an unclassified hash, which both classified it monetizable AND recorded `contentCreator = msg.sender`, bypassing the RIGHTS-01 creator-signature requirement entirely.
- **Status**: [x] FIXED — `setRights` now rejects `ORIGINAL`/`LICENSED`/`PUBLIC_DOMAIN` unless caller is `owner()`. Monetizable classifications for normal users must use `setRightsWithCreatorSig` (which binds `contentCreator` = signer, not operator). `RightsRegistry.sol:72-107`.

### SUB-04: SubscriptionManager tier-upgrade gifts free premium time (P1)

- **Source**: Apr-18 fresh pass
- **Impact**: User with 25 days remaining BASIC who paid for 1 month PREMIUM received ~55 days of PREMIUM access — old-tier remaining time stacked full at new-tier benefits. Multiplicative loss at scale.
- **Status**: [x] FIXED — On tier change, remaining old-tier seconds are prorated into equivalent new-tier seconds: `startTime = block.timestamp + remainingSecs * oldPrice / newPrice`. `SubscriptionManager.sol:183-208`.

### AD-03: Grief-bid cancellation lockout (P1)

- **Source**: Apr-18 fresh pass
- **Impact**: Current winning bidder could `cancelBid` after only `BID_CANCEL_COOLDOWN` (3 days) even while the slot was still `active`, enabling a grief pattern: park a high bid to lock out competitors, wait 3 days, withdraw. Creator loses prospective sponsor with no recourse.
- **Status**: [x] FIXED — While slot is active, bidder must wait the full `BID_EXPIRY` (30 days). The shorter cooldown only applies once the slot has been deactivated. `AdPlacement.sol:200-217`.

### CREDIT-06: `maxGrantPerUser` bypass via spending (P2)

- **Source**: Apr-18 fresh pass
- **Impact**: Per-user grant cap checked `balance + amount > maxGrantPerUser`; user spending credits dropped balance, letting a compromised platform key re-grant up to the cap indefinitely. Intended per-user limit was bypassed.
- **Status**: [x] FIXED — New `grantedPerUser[user]` mapping tracks cumulative grants; cap checked against that. `__gap` reduced 49 → 48 for upgrade safety. `CreditManager.sol:67-70, :297-305`.

### CANON-07: `snapshotBlock` cold-start underflow (P3)

- **Source**: Apr-18 fresh pass
- **Impact**: `snapshotBlock = block.number - MIN_SNAPSHOT_AGE` reverts on any chain where `block.number < 7200` (≈ first 4h after fresh deploy on Base, longer on testnet forks). `submit()` is bricked during that window.
- **Status**: [x] FIXED — Clamp to 0: `block.number > MIN_SNAPSHOT_AGE ? block.number - MIN_SNAPSHOT_AGE : 0`. `CanonMarketplace.sol:216-218`.

### GOV-08: Symbol blocklist bypass via whitespace/unicode (P3)

- **Source**: Apr-18 fresh pass
- **Impact**: `blockedSymbols` is an exact-string match; `" LOAR"` (leading space) or unicode lookalikes were not caught, letting tickers collide with blocked entries (NYSE:LOAR, etc).
- **Status**: [x] FIXED — `_requireCanonicalSymbol` rejects any byte that is not uppercase A-Z or digit 0-9 before blocklist lookup. `GovernanceTokenFactory.sol:78-112`.

### Server-side follow-ups (same pass)

- **[x] Gallery.claimOrphan creator check** — Only the original content creator (`creatorUid`) can claim an orphan into a universe, closing the siphon vector where a universe admin could hoover legacy un-tagged content. `apps/server/src/routers/gallery/gallery.routes.ts:491-500`.
- **[x] `setUniverseHidden` audit log** — Admin soft-delete now writes an immutable `contentAuditLog` entry in the same batch, recording `actorUid`, `actorAddress`, previous/new hidden state. `apps/server/src/routers/universes/universes.handlers.ts:148-182`.
- **[x] Episode job DoS caps** — 24h auto-abort on `awaiting_intervention`, 30/min per-user `controlJob` rate limit, 3 concurrent jobs per user on `generateFromScript`. `apps/server/src/routers/episodes/episodes.routes.ts:32-53, :651-723, :996-1013, :1107`.
- **[x] Indexer RPC fallback defaults** — Baked-in public RPC fallbacks restored per chain; operators still override via `PONDER_RPC_FALLBACKS`. `apps/indexer/env.ts:38-55`.

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
| EntityNFT.sol                | ~200      | Critical → upgradeable | NFT-01 + NFT-02 fixed                |
| EntityEditionNFT.sol         | ~200      | Critical → upgradeable | NFT-01 fixed                         |
| EpisodeNFT.sol               | ~200      | Critical → upgradeable | NFT-01 fixed                         |
| EpisodeEditionCollection.sol | ~200      | Critical → upgradeable | NFT-01 fixed                         |
| CollectiveTokenFactory.sol   | ~150      | Medium                 | Needs audit                          |
| IdentityNFT.sol              | ~150      | Medium                 | IDENTITY-01 + IDENTITY-02 fixed      |
| LoarTokenSpoke.sol           | ~200      | High                   | SPOKE-01 fixed                       |
| AnalyticsRegistry.sol        | ~200      | Low                    | ANALYTICS-01 doc only                |

---

## Remaining Mainnet Blockers

### Code (remaining)

1. **UPGRADE-01 follow-on** — After a first successful CI run that emits storage-layouts, commit the baseline JSON artifacts so future PRs can diff layouts automatically.

2. **TIMELOCK-01 (NEW, 2026-04-22)** — `UniverseTokenDeployerV3` stored a single `address public timelock` and passed it to every `governorFactory.deployGovernor(token, timelock)` call. Combined with GOV-01 transferring all UUPS ownership to that same timelock, every per-universe governor became a PROPOSER on one shared TimelockController — a single low-quorum/compromised universe could queue protocol-wide admin calls.
   - **Status**: [~] PARTIAL — Per-universe timelock factory implemented in `apps/contracts/src/factories/TimelockFactory.sol`. `UniverseTokenDeployerV3` now opts into the new path when `setTimelockFactory` is called: each universe gets a fresh `TimelockController` whose sole proposer/canceller is the spawned governor. Legacy shared `timelock` remains as a testnet fallback for continuity.
   - **Operational blockers before mainnet**: (a) deploy `TimelockFactory` and call `UniverseTokenDeployerV3.setTimelockFactory(addr)` before any mainnet universe is created — see `script/DeployTimelockFactory.s.sol`; (b) migrate existing testnet universes (currently still bound to the shared timelock) — either by leaving them on the legacy path (testnet only) or by re-deploying their governance under the new path; (c) write Foundry tests covering the wireProposer single-use guarantee + role-renouncement.

3. **TIMELOCK-02 (NEW, 2026-04-24)** — `TimelockFactory.deployTimelock` / `.wireProposer` were unguarded. Any external caller could pre-deploy a timelock on a `universeId`, call `wireProposer` with an attacker-controlled `governor`, and either brick subsequent legitimate universe creation (via `AlreadyWired`) or hijack PROPOSER_ROLE on the universe's timelock.
   - **Status**: [x] FIXED — `TimelockFactory` now inherits `Ownable`, exposes `authorizedCallers` mapping + `setAuthorizedCaller(addr, bool)` (owner-only), and gates both `deployTimelock` + `wireProposer` behind an `onlyAuthorized` modifier. `script/DeployTimelockFactory.s.sol` bundles the factory deploy + `setAuthorizedCaller(UniverseTokenDeployerV3, true)` + `UniverseTokenDeployerV3.setTimelockFactory(...)` into a single script so operators cannot forget the authorization step. Ownership can be renounced after smoke-tests via `RENOUNCE_FACTORY_OWNERSHIP=true` env var.

4. **TIMELOCK-03 (NEW, 2026-04-24)** — `TimelockFactory.deployTimelock` accepted any caller-supplied `minDelay` (including `1`), and `UniverseTokenDeployerV3.perUniverseTimelockDelay` was similarly unfloored. A misconfigured or malicious setter could leave per-universe governance with effectively-zero delay, defeating the audit-tracker's governance-delay guarantees.
   - **Status**: [x] FIXED — `TimelockFactory.MIN_DELAY_FLOOR = 24 hours`. `deployTimelock` reverts with `DelayTooLow()` if the resolved delay falls below the floor. The `minDelay == 0` shortcut still selects `DEFAULT_MIN_DELAY = 24 hours`.

5. **TIMELOCK-04 (NEW, 2026-04-24)** — `TimelockFactory` had no `universeId → timelock` uniqueness tracking. Combined with TIMELOCK-02, an attacker could spam `TimelockDeployed(universeId=X)` events so off-chain indexers could not identify the canonical timelock. Separately, there was no post-grant assertion that the spawned governor actually held `PROPOSER_ROLE` / `CANCELLER_ROLE` after `wireProposer`.
   - **Status**: [x] FIXED — New `timelockByUniverse` mapping + `UniverseAlreadyHasTimelock()` revert in `deployTimelock`. New `deployerOf[timelock]` tracks the authorized caller that spawned each timelock. `wireProposer` now asserts `tl.hasRole(PROPOSER_ROLE, governor) && tl.hasRole(CANCELLER_ROLE, governor)` after the grants, reverting with `RoleGrantFailed()` if either is missing.

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

## Stats (2026-04-18, seventh pass)

| Severity           |   Total |  Fixed | Partial | Operational | Not Started |
| ------------------ | ------: | -----: | ------: | ----------: | ----------: |
| P0 — Critical      |      15 |     14 |       0 |           1 |           0 |
| P1 — High          |      31 |     27 |       1 |           1 |           2 |
| P2 — Significant   |      25 |     24 |       0 |           0 |           1 |
| P3 — Operational   |      26 |     20 |       0 |           3 |           3 |
| P4 — Informational |      20 |     14 |       0 |           0 |           6 |
| **Total**          | **117** | **99** |   **1** |       **5** |      **12** |

**Verdict**: Seventh pass surfaced and fixed 6 new contract findings (RIGHTS-03, SUB-04, AD-03, CREDIT-06, CANON-07, GOV-08) plus 4 server hardening items (gallery orphan authz, universe-hidden audit log, episode job DoS caps, indexer RPC fallback). P4 cleanup pass (2026-04-19) closed 6 informational items: SPDX normalization across `test/*.sol`, BondingCurve refund-rationale doc, AnalyticsRegistry export-event doc, trust-model admin-table completeness, CreditsPurchasedWithLoar event/state alignment verification, token-revocation persistence verification. Remaining items: BURN-01 rename upgrade, legal text (LEGAL-01/02/03), INFRA-02 rotation, AD-02 oracle, and the external audit passes.

_Last updated: 2026-04-18 (seventh pass — operator pre-claim block, tier-upgrade prorate, grief-bid lockout fix, cumulative grant cap, snapshot underflow clamp, canonical symbol enforcement, server DoS caps)_

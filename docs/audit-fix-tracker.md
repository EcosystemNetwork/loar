# LOAR Contract Audit — Consolidated Fix Tracker

**Sources**: 5 independent reviews (Apr 16–17, 2026)

- Audit A: Launch Readiness Audit (Apr 16)
- Audit B: Contract Security Deep Audit, Parts 1–3 (Apr 16–17)
- Audit C: Pre-Audit Review — Mainnet Readiness, Part 1 (Apr 17)
- Audit D: Extended Review — NFT Architecture, Staking, Governance, Revenue (Apr 17)
- Audit E: Pre-Audit Review — Part 3: Revenue, Factories, Token, Deployment (Apr 17)

**Verdict (unanimous): NOT mainnet ready.** Audit D recommends a second audit pass after fixes — C-7 alone is a ground-up rewrite of 5 contracts. Audit E reveals factories deploy wrong Governor/Token code — the documented security model is fiction.

---

## Fix Priority Legend

| Priority | Meaning                                          | SLA                                 |
| -------- | ------------------------------------------------ | ----------------------------------- |
| P0       | Permanent fund loss or total protocol compromise | Fix before any deployment           |
| P1       | Exploitable within hours on mainnet              | Fix before mainnet                  |
| P2       | Significant risk, exploitable with effort        | Fix before mainnet                  |
| P3       | Operational / gas / UX risk                      | Fix before or shortly after mainnet |
| P4       | Informational / cleanup                          | Address in normal dev cycle         |

---

## P0 — Permanent Fund Loss / Protocol Takeover

### GOV-01: Single EOA owns all UUPS + Beacons — no timelock

- **Sources**: A, B (C1), C (C-6) — flagged by all 3 audits
- **Contracts**: UniverseManager, PaymentRouter, CanonMarketplace, CreditManager, SubscriptionManager, LicensingRegistry, CollabManager, AdPlacement, AnalyticsRegistry, RightsRegistry + all Beacon proxies
- **Impact**: Compromised deployer key = instant drain of every contract via malicious `upgradeTo`
- **Fix**: Deploy Gnosis Safe (3/5 minimum) → OpenZeppelin TimelockController (48h minimum for non-emergency) → transfer ownership of all UUPS and beacons. Verify upgrade paths through timelock on a fork.
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: This is the single highest-leverage fix. Every other finding is moot if the deployer key leaks.

### CANON-01: CanonMarketplace accepts arbitrary `universeToken` — sockpuppet attack

- **Sources**: B (C5)
- **Contract**: `CanonMarketplace.sol`
- **Impact**: Attacker deploys own IVotes token, votes own submissions through, injects canon into any universe, collects licensing fees
- **Fix**: Look up real governance token via `UniverseManager.getUniverseData(universeId)` in `submit()`. Reject mismatched tokens.
- **Status**: [ ] Not started
- **Assignee**:

### CANON-02: CanonMarketplace `vote()` reentrancy via malicious IVotes token

- **Sources**: B (C6/H7)
- **Contract**: `CanonMarketplace.sol`
- **Impact**: Combined with CANON-01, attacker's token can reenter `vote()` and multiply voting weight
- **Fix**: Add `nonReentrant` modifier + move `hasVoted[submissionId][msg.sender] = true` BEFORE external call to `getPastVotes`
- **Status**: [ ] Not started
- **Assignee**:

### CANON-03: Flash-loan / borrow-and-vote attack — MIN_SNAPSHOT_AGE = 15 blocks

- **Sources**: C (C-2)
- **Contract**: `CanonMarketplace.sol`
- **Impact**: Borrow governance tokens, hold 15 blocks (~30s on Base), submit + vote with full weight, repay loan. Permanent fund theft via canon manipulation.
- **Fix**: Use a long cooldown (1–7 days of holding), require token locking during vote window, or use a timelock-backed Governor instead of bespoke voting
- **Status**: [ ] Not started
- **Assignee**:

### CANON-04: Failed-quorum submissions permanently brick held ETH

- **Sources**: C (C-3)
- **Contract**: `CanonMarketplace.sol`
- **Impact**: `finalize()` reverts on `QuorumNotReached`. If voting period ends without quorum, status stays VOTING, `creatorHeldAmount` never cleared. Funds stuck forever.
- **Fix**: Add expired/refundable path — after deadline + grace period, creator can claim refund on failed quorum
- **Status**: [ ] Not started
- **Assignee**:

### CREDIT-01: `grantCredits` is an unbounded mint by a hot key

- **Sources**: B (Medium, escalated), C (C-5)
- **Contract**: `CreditManager.sol`
- **Impact**: Leaked `platform` key = infinite generations at API provider expense. No per-tx cap, no daily cap, no cumulative cap.
- **Fix**: Add per-user and per-period rate limits + circuit breaker (e.g., max 10k credits/day, max 1k/user/day)
- **Status**: [ ] Not started
- **Assignee**:

### CREDIT-02: `platform` address immutable — no rotation if key leaks

- **Sources**: B (H10 on Escrow), C (C-4)
- **Contracts**: `CreditManager.sol`, `Escrow.sol`
- **Impact**: No way to rotate platform address without UUPS upgrade. Controls `createPackage`, `spendCredits`, `grantCredits`, `setHolderDiscount`, `setGenerationCost`, `updateLoarToken`, `deactivatePackage`.
- **Fix**: Add `setPlatform(address)` behind `onlyOwner` (with timelock from GOV-01)
- **Status**: [ ] Not started
- **Assignee**:

### PAY-01: Payment verifiers don't check `tx.from` matches authenticated user

- **Sources**: B (C4)
- **Contracts**: `credits.routes.ts`, `stripe.routes.ts`
- **Impact**: Anyone with a block explorer can replay another user's tx hash to claim their purchase
- **Fix**: 3 one-line fixes — verify `tx.from === ctx.user.address` in each payment verification handler
- **Status**: [ ] Not started
- **Assignee**:

### TOKEN-01: TOKEN_SUPPLY 100x mismatch (1B vs 100B)

- **Sources**: B (C7)
- **Contracts**: `UniverseManager.sol`, `UniverseTokenDeployerV3.sol`
- **Impact**: Every indexer/explorer/dashboard shows wrong numbers on launch day
- **Fix**: Pick one number, update both contracts
- **Status**: [ ] Not started
- **Assignee**:

### NFT-01: All 5 NFT beacon proxies use non-upgradeable OZ bases — broken architecture

- **Sources**: D (C-7)
- **Contracts**: `CharacterNFT.sol`, `EpisodeNFT.sol`, `EntityNFT.sol`, `EntityEditionNFT.sol`, `EpisodeEditionCollection.sol`
- **Impact**: ERC721 constructor runs on implementation, not proxy → `name()`/`symbol()` return empty strings (CharacterNFT, EpisodeNFT). Non-upgradeable storage layout means any future OZ upgrade shifts slots → permanent fund loss. EntityNFT patches symptom with `pure` override but doesn't fix root cause.
- **Fix**: Ground-up rewrite of all 5 contracts to use `ERC721Upgradeable`, `ERC721EnumerableUpgradeable`, `ERC721URIStorageUpgradeable`, `ERC2981Upgradeable`, `ERC1155Upgradeable`. Move name/symbol to `initialize()`. Verify storage layout compatibility with `forge inspect`.
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: This is the largest single fix. Budget for introducing new bugs — second audit pass required after this rewrite.

### GOV-06: GovernorFactory deploys inline Governor with NO timelock — zero anti-rug

- **Sources**: E (C-13)
- **Contracts**: `GovernorFactory.sol`, `UniverseTokenDeployerV3.sol`
- **Impact**: Three Governor implementations exist; factory deploys the stripped-down inline one. No timelock, no early-life quorum. Creator holds ~10% supply, is often the only delegated voter (GOV-02), can propose + pass + execute instantly. Zero anti-rug mechanism in deployed governance.
- **Fix**: Rewrite GovernorFactory.deployGovernor to take TimelockController param, deploy timelock per universe, wire it. Update UniverseTokenDeployerV3 to pass through. Delete inline Governor from factory. Delete unused src/UniverseGovernor.sol and src/UniverseTimelockGovernor.sol — keep exactly one implementation.
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: This is a "ship wrong code" bug — the documented security model (24h timelock, 20% early-life quorum) is dead code. Combined with GOV-02 (no auto-delegation), governance is a creator dictatorship.

### GOV-07: GovernanceTokenFactory deploys inline token without symbol validation

- **Sources**: E (C-14)
- **Contracts**: `GovernanceTokenFactory.sol`
- **Impact**: src/GovernanceERC20.sol has length validation + blocklist. Factory has inline copy with none of it. Deployed token allows any symbol: AAPL, TSLA, 1-char, 40-char. The "H4 fix" is dead code.
- **Fix**: Delete inline GovernanceERC20 from factory. Import and deploy the real one. Ensure blocklist is wired (GOV-03).
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: Same "ship wrong code" pattern as GOV-06. Two inline duplicates must be deleted.

### CONTENT-01: ContentLicensing.registerContent skips rights-registry check

- **Sources**: E (C-16)
- **Contract**: `ContentLicensing.sol`
- **Impact**: Every other revenue contract gates on `rightsRegistry.isMonetizable(contentHash)`. ContentLicensing does not. Users can register content they don't own or content flagged FUN/FROZEN and collect sale/rent/license payments. Direct DMCA/legal exposure.
- **Fix**: Add `require(rightsRegistry.isMonetizable(contentHash))` in `registerContent`.
- **Status**: [ ] Not started
- **Assignee**:

### MARKET-01: SlopMarket ignores ERC2981 royalties

- **Sources**: E (C-17)
- **Contract**: `SlopMarket.sol`
- **Impact**: NFT contracts implement ERC2981 with `_setTokenRoyalty(tokenId, creator, N)`. SlopMarket.buy routes through PaymentRouter without querying `royaltyInfo()`. Every sale through the platform's own marketplace strips creator royalties.
- **Fix**: Query `IERC2981(tokenContract).royaltyInfo(tokenId, totalPrice)` before routing. Split price three ways: creator royalty, seller remainder, platform fee.
- **Status**: [ ] Not started
- **Assignee**:

### STAKE-01: LaunchpadStaking lock-period trivially bypassable via 1-wei seed

- **Sources**: D (C-9)
- **Contract**: `LaunchpadStaking.sol`
- **Impact**: `stake()` only sets `stakedAt` on first stake (`if (s.stakedAt == 0)`). Attack: stake 1 wei at T=0, wait 7 days, stake 1M $LOAR at T+7d+1s, immediately unstake — no penalty. Entire 5% early-unstake penalty + 7-day lock defeated. Same bug in `stakeInUniverse`/`unstakeFromUniverse` via `us.stakedAt`.
- **Fix**: Update `stakedAt` on each incremental stake (weighted average of existing and new amounts), or track per-deposit timestamps in an array.
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: Will be exploited on day one — requires zero sophistication.

---

## P1 — Exploitable Within Hours on Mainnet

### TOKEN-02: LoarToken fee-on-transfer breaks Uniswap v4, LP locker, PaymentRouter, CreditManager, and ALL protocol contracts

- **Sources**: B (C3), C (H-3), E (C-15)
- **Contracts**: `LoarToken.sol`, `PaymentRouter.sol`, `RemixFees.sol`, `TokenVesting.sol`, `StoryBounties.sol`, `CreditManager.sol`, `LoarBurner.sol`, `LaunchpadStaking.sol`, all consumers
- **Impact**: Every non-exempt transfer skims transferFeeBps (1–500bp) to LP. ALL protocol contracts assume `safeTransferFrom(user, this, amount)` delivers exactly `amount`. Internal accounting exceeds actual balance → eventual reverts. **Strong recommendation: remove the fee entirely** — code cost, audit cost, and footgun risk outweigh 1bp LP depth benefit.
- **Fix**: OPTION A (recommended): Remove fee-on-transfer from LoarToken entirely. OPTION B: Add every protocol contract to `feeExempt` at deploy + maintain forever across upgrades + add invariant tests. Also clean up dead `feeExemptPairs` mapping (unused in `_update` logic).
- **Status**: [ ] Not started
- **Assignee**:

### TOKEN-03: LoarToken `totalMinted` vs `totalSupply()` cap contradiction — burns reopen mint

- **Sources**: B (C2)
- **Contract**: `LoarToken.sol`
- **Impact**: Burns reopen mint headroom, potentially inflating supply beyond intended cap
- **Fix**: Track `totalMinted` separately from `totalSupply()`, cap based on minted not current supply
- **Status**: [ ] Not started
- **Assignee**:

### CURVE-01: BondingCurve buy/sell has no `deadline` parameter — MEV sandwich

- **Sources**: C (H-1)
- **Contract**: `BondingCurve.sol`
- **Impact**: MEV bots hold txs in mempool, execute at adverse prices on every trade
- **Fix**: Add `uint256 deadline` parameter, `require(block.timestamp <= deadline)`
- **Status**: [ ] Not started
- **Assignee**:

### CURVE-02: `setTradingHalted` is a centralization kill-switch

- **Sources**: C (H-2)
- **Contract**: `BondingCurve.sol`
- **Impact**: UniverseManager owner can halt any universe's curve, preventing graduation
- **Fix**: Guard behind timelock (GOV-01), emit clear events, document prominently — or remove and rely on Pausable at manager level only
- **Status**: [ ] Not started
- **Assignee**:

### RIGHTS-01: RightsRegistry classifications rewritable by any operator without creator signature

- **Sources**: B (H8)
- **Contract**: `RightsRegistry.sol`
- **Impact**: Compromised operator flips ORIGINAL→FUN (blocks monetization) or FUN→ORIGINAL (wash classification)
- **Fix**: Require creator signature for state transitions + put operator set behind timelock
- **Status**: [ ] Not started
- **Assignee**:

### UNIVERSE-01: `setMedia`/`swapNodes` rewrites content without updating attribution

- **Sources**: B (L14, escalated), C (H-4)
- **Contract**: `Universe.sol`
- **Impact**: Admin can reassign popular content to own wallet before monetization triggers
- **Fix**: Remove functions, scope to emergencies behind timelock, or keep creator field tied to content
- **Status**: [ ] Not started
- **Assignee**:

### UNIVERSE-02: Canon flag inconsistent after `setCanon`

- **Sources**: C (H-5)
- **Contract**: `Universe.sol`
- **Impact**: Only tip + previous tip toggled. Arbitrary nodes on canon chain have `canon = false`. Off-chain consumers misread state.
- **Fix**: Derive canon membership via traversal (remove boolean) or walk-and-update on every `setCanon`
- **Status**: [ ] Not started
- **Assignee**:

### UNIVERSE-03: `metadataRenderer` mutable — retroactive tokenURI change

- **Sources**: C (H-6)
- **Contract**: `UniverseManager.sol`
- **Impact**: Changing renderer retroactively changes tokenURI for every previously-minted universe NFT. Breaks marketplace listings.
- **Fix**: Add timelock and/or lock-once flag
- **Status**: [ ] Not started
- **Assignee**:

### UNIVERSE-04: `_update` bricked by broken `Universe.setAdmin`

- **Sources**: C (H-8)
- **Contract**: `UniverseManager.sol`
- **Impact**: If Universe ever reverts on `setAdmin`, NFT becomes non-transferable
- **Fix**: Wrap in try/catch or allow explicit opt-out with ownership recovery
- **Status**: [ ] Not started
- **Assignee**:

### LOCKER-01: LP Locker `withdrawEth()`/`withdrawERC20()` drain entire balance

- **Sources**: B (High)
- **Contract**: `LoarLpLockerMultiple.sol`
- **Impact**: `onlyOwner` can drain — contradicts "locked" marketing
- **Fix**: Put behind timelock/multisig (GOV-01)
- **Status**: [ ] Not started
- **Assignee**:

### LOCKER-02: `updateRewardAdmin`/`updateRewardRecipient` — instant replacement, no delay

- **Sources**: B (Medium), C (H-7)
- **Contract**: `LoarLpLockerMultiple.sol`
- **Impact**: Compromised admin key redirects future fee stream forever
- **Fix**: 2-step transfer (propose + accept) with cooldown, or require factory/owner co-signature
- **Status**: [ ] Not started
- **Assignee**:

### HOOK-01: LoarHookStaticFee `_beforeSwap`/`_afterSwap` missing override verification

- **Sources**: B (H4)
- **Contract**: `LoarHookStaticFee.sol`
- **Impact**: Hook may silently not fire on swaps
- **Fix**: Verify wiring with `forge inspect`. Add integration test.
- **Status**: [ ] Not started
- **Assignee**:

### AUTH-01: SIWE defaults `chainId` to 1 (mainnet) when wallet hasn't reported chain

- **Sources**: B (H9)
- **Contract**: Frontend SIWE flow
- **Impact**: Cross-environment phishing vector — signature valid on wrong chain
- **Fix**: Pin to single required chain per deployment (8453 for Base mainnet)
- **Status**: [ ] Not started
- **Assignee**:

### AUTH-02: Rate-limiter fallback key `'unknown-' + Date.now()` disables rate limiting

- **Sources**: B (H11)
- **Contract**: Rate-limit middleware
- **Impact**: Behind Railway proxy, socket address often unavailable — unique key per ms = no rate limit
- **Fix**: Return constant fallback key to share one bucket
- **Status**: [ ] Not started
- **Assignee**:

### ROYALTY-01: CharacterNFT.claimRoyalties() emits success event but transfers nothing

- **Sources**: D (C-8)
- **Contract**: `CharacterNFT.sol` (lines 206–211)
- **Impact**: Reads `claimableRoyalties[msg.sender]`, sets to 0, emits `RoyaltyClaimed` — no ETH transfer. Royalties actually live in PaymentRouter. Users call this, see "claimed" event, assume paid, nothing arrives. Destroys local accounting while ETH is recoverable elsewhere.
- **Fix**: Remove the function entirely (users must call `paymentRouter.claim()`), or make it forward to PaymentRouter.
- **Status**: [ ] Not started
- **Assignee**:

### DEED-01: StructuralDeed.mintDeed — no universe-ownership check

- **Sources**: E (H-22)
- **Contract**: `StructuralDeed.sol`
- **Impact**: Anyone can mint DOMAINs claiming `universeId = N` even if they don't own universe N. Name-squatting all universe territories.
- **Fix**: Verify `msg.sender == universeManager.ownerOf(universeId)` or `Universe.getAdmin()`.
- **Status**: [ ] Not started
- **Assignee**:

### COLLAB-01: CollabManager — proposer/acceptor trusted on blind faith

- **Sources**: E (H-23)
- **Contract**: `CollabManager.sol`
- **Impact**: Anyone proposes `proposeCollab(universeA=5, universeB=7, targetAcceptor=Bob)`. When accepted, proposer collects universe A's share despite having no relation to universe 5. `universeManager` stored but never read.
- **Fix**: Gate `proposeCollab` on `universeManager.ownerOf(universeA) == msg.sender` and `acceptCollab` on `universeManager.ownerOf(universeB) == msg.sender`.
- **Status**: [ ] Not started
- **Assignee**:

### BOUNTY-01: StoryBounties — poster can rug accepted winner

- **Sources**: E (H-24)
- **Contract**: `StoryBounties.sol`
- **Impact**: After deadline, anyone calls `expireBounty()` returning full reward to poster. If winner's submission was accepted verbally, poster runs `expireBounty` before `awardBounty`, keeping both work and money.
- **Fix**: Add submission lock that prevents `expireBounty` once submissions exist, or require explicit rejection before expiry.
- **Status**: [ ] Not started
- **Assignee**:

### SPOKE-01: LoarTokenSpoke diverges from hub in safety features

- **Sources**: E (H-26)
- **Contract**: `LoarTokenSpoke.sol`
- **Impact**: No Pausable, no FEE_CHANGE_COOLDOWN, default fee 5bp vs 1bp on hub. Cap checked via `totalSupply()` not `totalMinted` — burn-and-remint cycles reset cap each time. Any bridge compromise mints up to cap on every spoke.
- **Fix**: Port all safety features from hub: Pausable, cooldown, `totalMinted` tracking. Align default fee. Add NTT manager verification.
- **Status**: [ ] Not started
- **Assignee**:

### SPLIT-02: SplitRouter.setSplits — no lock, owner can redirect before payment

- **Sources**: E (H-27), extends SPLIT-01
- **Contract**: `SplitRouter.sol`
- **Impact**: `splitOwner` reconfigures splits instantly, no delay, no co-recipient consent. Before large incoming payment, owner sets `[{owner, 10000}]`, collects, re-spreads.
- **Fix**: Add commit-delay or frozen mode requiring co-signer consent. Put behind timelock.
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: More severe than SPLIT-01 (which only covers `setPaymentRouter`). This is the split distribution itself.

### ESCROW-03: Escrow.resolveDispute is single-EOA dictatorship over all disputed trades

- **Sources**: D (C-10)
- **Contract**: `Escrow.sol`
- **Impact**: `onlyOwner` picks arbitrary buyer/seller split. Compromised key routes all disputed escrows to attacker. Even without compromise, raw centralized power over user funds.
- **Fix**: Move to multisig with DAO appeal, add max resolution time, emit proof-of-reason (IPFS hash).
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: Escalates ESCROW-01 scope — dispute resolution itself is the problem, not just the fee.

### GOV-02: GovernanceERC20 has no auto-delegation — governance quorum unreachable

- **Sources**: D (C-11)
- **Contract**: `GovernanceERC20.sol`
- **Impact**: `ERC20Votes` requires explicit `delegate(self)` to have voting power. Empirical delegation rates are 10–30%. A 10% quorum of total supply is effectively 30–100% of delegated supply. Governance is dead on arrival.
- **Fix**: Override `_update` to auto-delegate `_delegate(to, to)` on first receipt if holder hasn't delegated, OR mandate delegation in UI on token receipt.
- **Status**: [ ] Not started
- **Assignee**:

### GOV-03: GovernanceERC20 symbol blocklist is security theater — never checked

- **Sources**: D (C-12)
- **Contract**: `GovernanceERC20.sol`
- **Impact**: `blockedSymbols` mapping exists with add/remove functions, but constructor only validates length (3–10 chars). "AAPL", "TSLA", "NVDA" deploy successfully. Comment claims validation exists — it doesn't.
- **Fix**: Move blocklist check to `UniverseTokenDeployerV3` and enforce before constructing the token.
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: Escalates LEGAL-03 (NYSE collision) — the mitigation that was supposed to exist doesn't work.

### AD-01: AdPlacement bids locked forever — no cancellation or expiry

- **Sources**: D (H-10)
- **Contract**: `AdPlacement.sol`
- **Impact**: Once `bid()`, ETH stuck until outbid or creator calls `acceptBid`. No deadline, no bidder withdrawal. Creator ghosts → ETH permanently stuck.
- **Fix**: Add `cancelBid()` with cooldown and/or slot-expiry mechanism.
- **Status**: [ ] Not started
- **Assignee**:

### REVENUE-01: 5 revenue contracts trust platform-set `universeCreators` without on-chain verification

- **Sources**: D (H-11)
- **Contracts**: `CanonMarketplace.sol`, `LicensingRegistry.sol`, `SubscriptionManager.sol`, `AdPlacement.sol`, `RemixFees.sol`
- **Impact**: `registerUniverse(universeId, creator)` accepts arbitrary address. No verification against `UniverseManager.ownerOf()` or `Universe.getAdmin()`. Platform bug, leaked key, or malicious operator redirects all universe revenue.
- **Fix**: Have `registerUniverse` read from `UniverseManager.ownerOf(universeId)` or `Universe.getAdmin()` — never accept an arbitrary address.
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: Systemic pattern — needs a consistent on-chain source-of-truth wired through every contract.

### SUB-01: SubscriptionManager tier downgrade silently nukes paid time

- **Sources**: D (H-13)
- **Contract**: `SubscriptionManager.sol`
- **Impact**: Active PREMIUM subscriber with 10 months remaining calls `subscribe(id, BASIC, 1)` → tier overwritten to BASIC, `expiresAt += 30 days`. Paid PREMIUM time converted to BASIC with no refund. Rug vector or critical UX bug.
- **Fix**: Reject tier downgrades while active, or compute prorated credit for the differential.
- **Status**: [ ] Not started
- **Assignee**:

### RIGHTS-02: RightsRegistry.freeze() is single-operator kill switch over all content

- **Sources**: D (H-16)
- **Contract**: `RightsRegistry.sol`
- **Impact**: Any address in `operators` mapping can irreversibly `freeze(hash, reason)`. Multiple contracts gate on `isMonetizable`. Leaked operator key freezes entire platform catalog.
- **Fix**: Require N-of-M operator consensus or owner confirmation. Add appeal/unfreeze path (FROZEN → UNDER_REVIEW → UNSET).
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: Complements RIGHTS-01 — operators have too much unilateral power over content state.

### LICENSE-01: LicensingRegistry.createLicense sets licensor = msg.sender (wrong when platform calls)

- **Sources**: D (H-18)
- **Contract**: `LicensingRegistry.sol`
- **Impact**: Platform calls `createLicense` on behalf of creator → platform becomes licensor → upfront fee routed to platform's creator slot via `paymentRouter.route(lic.licensor, ...)`. Platform collects creator's fee.
- **Fix**: Always set `lic.licensor = universeCreators[universeId]` regardless of caller.
- **Status**: [ ] Not started
- **Assignee**:

---

## P2 — Significant Risk, Requires Effort to Exploit

### ESCROW-01: `resolveDispute` has no platform-fee deduction

- **Sources**: B (M15)
- **Contract**: `Escrow.sol`
- **Impact**: Owner can resolve disputes directing full funds, enabling fund laundering
- **Fix**: Apply standard platform fee on dispute resolution
- **Status**: [ ] Not started
- **Assignee**:

### ESCROW-02: `setDisputeWindow` unbounded — near-max overflows `disputeDeadline`

- **Sources**: B (M16)
- **Contract**: `Escrow.sol`
- **Impact**: Setting near `type(uint256).max` enables immediate `claimExpired` on active escrows
- **Fix**: Cap `disputeWindow` to reasonable maximum (e.g., 30 days)
- **Status**: [ ] Not started
- **Assignee**:

### SPLIT-01: `SplitRouter.setPaymentRouter` — no lock on change

- **Sources**: B (M17)
- **Contract**: `SplitRouter.sol`
- **Impact**: Compromised owner redirects all revenue splits
- **Fix**: Behind timelock (GOV-01)
- **Status**: [ ] Not started
- **Assignee**:

### VESTING-01: `revokeVesting` + single-EOA = compromised key pulls all unvested

- **Sources**: B (M12), D (H-14)
- **Contract**: `TokenVesting.sol`
- **Impact**: Owner can revoke all vesting schedules and reclaim tokens. If used for investor allocations, they will reject revocable vesting.
- **Fix**: Behind timelock/multisig (GOV-01). Add timelocked revoke, require beneficiary consent, or provide non-revocable path for investor allocations.
- **Status**: [ ] Not started
- **Assignee**:

### VESTING-02: `claimAll` unbounded loop — gas griefing

- **Sources**: B (M13)
- **Contract**: `TokenVesting.sol`
- **Impact**: Too many vesting schedules = `claimAll` runs out of gas
- **Fix**: Cap loop at ~50, add pagination
- **Status**: [ ] Not started
- **Assignee**:

### CANON-05: Voting deadline uses `block.timestamp` vs `block.number` for snapshot

- **Sources**: B (M11)
- **Contract**: `CanonMarketplace.sol`
- **Impact**: Inconsistent time model between snapshot (block-based) and deadline (timestamp-based)
- **Fix**: Align to one model
- **Status**: [ ] Not started
- **Assignee**:

### CANON-06: Rejected submissions keep platform fee (undocumented)

- **Sources**: C (M-6)
- **Contract**: `CanonMarketplace.sol`
- **Impact**: Users will perceive this as theft if not documented
- **Fix**: Document in creator docs. Consider partial refund path.
- **Status**: [ ] Not started
- **Assignee**:

### CURVE-03: `MAX_BUY_AMOUNT` per-tx only — sybil-bypassable

- **Sources**: B (Low), C (M-3)
- **Contract**: `BondingCurve.sol`
- **Impact**: Multiple wallets or Flashbots bundles bypass the cap
- **Fix**: Document as UX hint or implement per-address cumulative cap
- **Status**: [ ] Not started
- **Assignee**:

### AUTH-03: SIWE in-memory nonce fallback unsafe for multi-instance

- **Sources**: B (M14)
- **Contract**: SIWE auth middleware
- **Impact**: Railway multi-replica = nonce not shared, replay possible across instances
- **Fix**: Use Redis or Firestore for nonce storage
- **Status**: [ ] Not started
- **Assignee**:

### AUTH-04: Frontend session validation silently keeps stale sessions on network error

- **Sources**: B (M18)
- **Contract**: Frontend auth
- **Impact**: Stale session persists, user appears authenticated when they shouldn't be
- **Fix**: Fail closed on verification error
- **Status**: [ ] Not started
- **Assignee**:

### GOV-04: UniverseGovernor.EARLY_LIFE_BLOCKS = 1,296,000 assumes Base 2s blocks

- **Sources**: D (H-12)
- **Contract**: `UniverseGovernor.sol`
- **Impact**: Hardcoded constant. On Ethereum mainnet (12s blocks) = 180 days, not 30. On Arbitrum (~0.25s blocks) = ~3.75 days. README mentions generic "Mainnet Deployment".
- **Fix**: Parameterize (pass at construction), use `block.timestamp`-based windows, or fork governor per chain.
- **Status**: [ ] Not started
- **Assignee**:
- **Notes**: Escalates P4 item "Governor constants hardcoded for Base L2 2s blocks" to P2.

### VESTING-03: TokenVesting.createVesting breaks on fee-on-transfer tokens

- **Sources**: D (H-15)
- **Contract**: `TokenVesting.sol`
- **Impact**: `safeTransferFrom(msg.sender, address(this), totalAmount)` stores `totalAmount` regardless of actual received. Fee-on-transfer tokens → claims eventually revert when contract balance runs out.
- **Fix**: Use pre/post-balance diffs, store actual received amount.
- **Status**: [ ] Not started
- **Assignee**:

### HOOK-02: LoarHook calls `_lpLockerFeeClaim` on every single swap — gas bomb

- **Sources**: D (H-17)
- **Contract**: `LoarHook.sol`
- **Impact**: Every swap triggers `collectRewardsWithoutUnlock(token)` → `modifyLiquiditiesWithoutUnlock` across up to 7 LP positions. Gas makes small trades economically infeasible.
- **Fix**: Claim every Nth swap or above a fee threshold, not every swap. Benchmark gas on realistic swaps.
- **Status**: [ ] Not started
- **Assignee**:

### LICENSE-02: LicensingRegistry.royaltyBps stored but never enforced

- **Sources**: D (H-19)
- **Contract**: `LicensingRegistry.sol`
- **Impact**: `payRoyalty(licenseId)` accepts whatever `msg.value` licensee sends. Stored `royaltyBps` is purely informational. Creators reading "5% royalty" assume it's enforced — it isn't.
- **Fix**: Enforce via revenue oracle (complex) or rename to `agreedRoyaltyBps` and document as off-chain binding only.
- **Status**: [ ] Not started
- **Assignee**:

### STAKE-02: LaunchpadStaking mixed global/universe reward accounting — single balance

- **Sources**: D (M-10)
- **Contract**: `LaunchpadStaking.sol`
- **Impact**: Both global and universe staking funnel $LOAR into same contract with different bookkeeping. Mistake in one path drains tokens owed to the other.
- **Fix**: Add invariant tests: `loarToken.balanceOf(this) >= totalStaked + totalUniverseStaked + sum(pendingRewards)`.
- **Status**: [ ] Not started
- **Assignee**:

### ESCROW-04: Escrow MAX_FEE_BPS = 5000 (50%) — predatory ceiling

- **Sources**: D (M-15)
- **Contract**: `Escrow.sol`
- **Impact**: `setDefaultFeeBps` allows up to 50% marketplace fees. Predatory.
- **Fix**: Cap at 1000 bps (10%).
- **Status**: [ ] Not started
- **Assignee**:

### UPGRADE-01: Storage gaps ad-hoc, no CI verification

- **Sources**: C (H-9)
- **Contracts**: All UUPS contracts
- **Impact**: Wrong slot = permanent fund loss on upgrade
- **Fix**: Use `forge inspect <Contract> storage` for all UUPS, compare pre/post-upgrade layouts, add to CI
- **Status**: [ ] Not started
- **Assignee**:

### TREASURY-01: `claimTeamFee(token)` transfers full balance — may sweep creator tokens

- **Sources**: C (I-3)
- **Contract**: `UniverseManager.sol`
- **Impact**: If manager holds governance tokens transiently, owner sweeps them
- **Fix**: Add allowlist of claim-eligible tokens
- **Status**: [ ] Not started
- **Assignee**:

### DEED-02: StructuralDeed.mintDeed — no overpayment refund

- **Sources**: E (H-21)
- **Contract**: `StructuralDeed.sol`
- **Impact**: Lines 158-160 send all `msg.value` (not required price) to treasury. Users overpaying lose difference silently.
- **Fix**: `require(msg.value == price)` or refund `msg.value - price` to sender.
- **Status**: [ ] Not started
- **Assignee**:

### TOKEN-04: UniverseTokenDeployerV3 lumps treasury+community allocations

- **Sources**: E (H-20)
- **Contract**: `UniverseTokenDeployerV3.sol`
- **Impact**: `safeTransfer(universeManager, treasuryAmount + communityAmount)`. `claimTeamFee` sweeps both. "500 bps to community" is actually platform-owned funds. Users misled.
- **Fix**: Split into separate recipients with different configurable addresses, or rename `communityBps` honestly.
- **Status**: [ ] Not started
- **Assignee**:

### IDENTITY-01: IdentityNFT claims soulbound but is freely transferable

- **Sources**: E (H-25)
- **Contract**: `IdentityNFT.sol`
- **Impact**: Docstring says "soulbound-style". Nothing overrides `_update`. INFTs representing co-creator identities can be sold on secondary markets.
- **Fix**: Override `_update` to revert on transfer (except mint), or fix documentation.
- **Status**: [ ] Not started
- **Assignee**:

### CREDIT-05: CreditManager.purchaseWithLoar fallback bypasses PaymentRouter

- **Sources**: E (M-18)
- **Contract**: `CreditManager.sol`
- **Impact**: If `address(paymentRouter) == address(0)`, direct transfer bypasses PaymentRouter accounting. Deployment order creates window where revenue doesn't flow through router.
- **Fix**: Remove fallback path — require PaymentRouter to be set. Or add deployment ordering check.
- **Status**: [ ] Not started
- **Assignee**:

### FACTORY-01: UniverseFactory.createUniverse — no access control

- **Sources**: E (M-22)
- **Contract**: `UniverseFactory.sol`
- **Impact**: Anyone creates orphan universes bypassing UniverseManager. No NFT, no LP seed, no fee paid. Creates indexer noise.
- **Fix**: Add `onlyManager` modifier.
- **Status**: [ ] Not started
- **Assignee**:

### TREASURY-02: Treasury set to `address(this)` breaks accounting

- **Sources**: C (M-4)
- **Contract**: `PaymentRouter.sol`
- **Impact**: Self-referencing treasury breaks pending withdrawal logic
- **Fix**: Add `require(newTreasury != address(this))`
- **Status**: [ ] Not started
- **Assignee**:

---

## P3 — Operational / Gas / UX Risk

### CREDIT-03: `setHolderDiscount` uncapped (>100% possible)

- **Sources**: B (Medium), C (M-5)
- **Contract**: `CreditManager.sol`
- **Fix**: Cap at 5000 bps (50%)
- **Status**: [ ] Not started

### CREDIT-04: Holder discount — 1 wei qualifies

- **Sources**: B (Medium)
- **Contract**: `CreditManager.sol`
- **Fix**: Set minimum holding threshold
- **Status**: [ ] Not started

### UNIVERSE-05: `getFullGraph` unbounded — DoS on large universes

- **Sources**: C (M-7)
- **Contract**: `Universe.sol`
- **Fix**: Remove or gate behind pagination only
- **Status**: [ ] Not started

### UNIVERSE-06: `_mintIdentityNfts` silently truncates >255 signers

- **Sources**: C (M-2)
- **Contract**: `UniverseManager.sol`
- **Fix**: Use `uint16` or emit event on truncation
- **Status**: [ ] Not started

### BUILD-01: `optimizer_runs=1` — runtime gas penalty on hot paths

- **Sources**: C (M-8)
- **File**: `foundry.toml`
- **Fix**: Set `optimizer_runs = 200` minimum (ideally 1_000_000 for revenue contracts). If contract size is the issue, refactor.
- **Status**: [ ] Not started

### BUILD-02: Pragma mismatch — `^0.8.30` vs `^0.8.28`

- **Sources**: C (L-4)
- **Fix**: Unify. Pin exact version `=0.8.30`.
- **Status**: [ ] Not started

### BUILD-03: No Slither/Mythril in CI

- **Sources**: A, C (I-4)
- **Fix**: Add to CI, zero High/Medium findings allowed to merge
- **Status**: [ ] Not started

### BUILD-04: No formal verification on bonding curve math

- **Sources**: C (I-5)
- **Fix**: Foundry invariant tests for `ethRaised <= integral` and `balance >= pendingRefunds + ethRaised`. Certora/Halmos for formal proofs.
- **Status**: [ ] Not started

### LEGAL-01: Terms of Service & Privacy Policy are placeholders

- **Sources**: A
- **Fix**: Real legal text at `/terms` and `/privacy`
- **Status**: [ ] Not started

### LEGAL-02: DMCA agent registration

- **Sources**: A
- **Fix**: $6 filing for 512(c) safe harbor
- **Status**: [ ] Not started

### LEGAL-03: NYSE ticker collision — $LOAR vs LOAR Holdings (NYSE:LOAR)

- **Sources**: B (L12), D (C-12 — blocklist that was supposed to prevent this doesn't work, see GOV-03)
- **Fix**: Rename token ticker or accept C&D risk from $475M aerospace company
- **Status**: [ ] Not started

### INFRA-01: Firestore as order source of truth — ETH paid but write fails = lost orders

- **Sources**: C (I-1)
- **Fix**: Idempotent order records keyed on tx hash + reconcile from Ponder chain events
- **Status**: [ ] Not started

### INFRA-02: `SIWE_JWT_SECRET` is single point of compromise

- **Sources**: C (I-2)
- **Fix**: Rotate regularly, use secrets manager instead of Railway env vars
- **Status**: [ ] Not started

### NFT-02: EntityNFT name/symbol pure overrides immutable across all beacon proxies

- **Sources**: D (M-11)
- **Contract**: `EntityNFT.sol`
- **Impact**: All universes share "LOAR Entities" / "LOAR-ENTITY" — can't customize per-universe.
- **Fix**: Document as intentional, or move name/symbol to `initialize()` params.
- **Status**: [ ] Not started

### GOV-05: UniverseGovernor proposal threshold 1M tokens (0.1%) — spam vector

- **Sources**: D (M-12)
- **Contract**: `UniverseGovernor.sol`
- **Impact**: Any moderately large holder can spam proposals. Combined with 7-day voting window = mild griefing.
- **Fix**: Raise threshold or add proposal deposit (slashed on rejection).
- **Status**: [ ] Not started

### HOOK-03: LoarHook protocolFee shared across all pools — cross-pool contamination

- **Sources**: D (M-13)
- **Contract**: `LoarHook.sol`
- **Impact**: Single `uint24 protocolFee` storage variable overwritten on every swap's `_setFee`. Multi-pool transactions may use wrong fee.
- **Fix**: Dedicated test for multi-pool atomic swaps. Consider per-pool fee storage.
- **Status**: [ ] Not started

### AD-02: AdPlacement.recordImpression — platform unilaterally inflates counts

- **Sources**: D (M-16)
- **Contract**: `AdPlacement.sol`
- **Impact**: Sponsors can't verify impressions. Platform can inflate.
- **Fix**: Add oracle or make impressions verifiable by on-chain episode mints.
- **Status**: [ ] Not started

### SUB-02: SubscriptionManager.configureTier has no price cap

- **Sources**: D (M-17)
- **Contract**: `SubscriptionManager.sol`
- **Impact**: `pricePerMonth` can be set to `2^256 - 1`, causing overflow on `months * pricePerMonth`.
- **Fix**: Add reasonable cap on `pricePerMonth`.
- **Status**: [ ] Not started

### BURN-01: LoarBurner misleadingly named — never burns $LOAR

- **Sources**: E (H-28)
- **Contract**: `LoarBurner.sol`
- **Impact**: Comment: "NO supply destruction." Users expecting deflationary burns get fee redistribution to LP/treasury. Tokenomics docs claiming "burns create scarcity" are unsupported.
- **Fix**: Rename to `PremiumActions` or `LoarFeeCollector`. Update tokenomics docs.
- **Status**: [ ] Not started

### FACTORY-02: Three Governor + two Token implementations — deploy-the-wrong-one risk

- **Sources**: E (H-29, M-25)
- **Contracts**: `GovernorFactory.sol`, `GovernanceTokenFactory.sol`, `UniverseGovernor.sol`, `UniverseTimelockGovernor.sol`, `GovernanceERC20.sol`
- **Impact**: Confusion for auditors and team. Wrong ones ARE being deployed (GOV-06, GOV-07).
- **Fix**: Delete unused. Have exactly one Governor and one token implementation. No inline duplicates in factories.
- **Status**: [ ] Not started

### ANALYTICS-01: AnalyticsRegistry.setTrending — platform-curated, not algorithmic

- **Sources**: E (M-19)
- **Contract**: `AnalyticsRegistry.sol`
- **Fix**: Document that "trending" is platform-curated. Fine if transparent.
- **Status**: [ ] Not started

### CONTENT-02: ContentLicensing DealStatus.EXPIRED never transitions

- **Sources**: E (M-24)
- **Contract**: `ContentLicensing.sol`
- **Impact**: Deals past endTime read as ACTIVE from `hasAccessFast`. Only `checkAccess` transitions to EXPIRED.
- **Fix**: Check time in `hasAccessFast` or add background transition mechanism.
- **Status**: [ ] Not started

### IDENTITY-02: IdentityNFT universeName/universeImage stale on rebrand

- **Sources**: E (M-21)
- **Contract**: `IdentityNFT.sol`
- **Fix**: Read from Universe contract dynamically or add update mechanism.
- **Status**: [ ] Not started

### MISC-01: Dead constant `teamFee = 0`

- **Sources**: C (M-1)
- **Contract**: `UniverseManager.sol`
- **Fix**: Remove
- **Status**: [ ] Not started

---

## P4 — Informational / Cleanup

- AnalyticsRegistry.requestDataExport emits event but no on-chain follow-through (E M-20)
- StoryBounties `*Changed` events declared but never emitted in setter functions (E M-23)
- `require()` strings → custom errors for gas savings (partially done)
- `BondingCurve.buy` uses `call{value: refund, gas: 50000}` — document or loosen
- `CreditManager.initialize` sets default generation costs inline — consider config struct
- Pin Solidity version (`=0.8.30` not `^0.8.30`)
- Re-deploy from clean source for mainnet (don't reuse Sepolia proxies)
- SPDX license mismatch (`UNLICENSED` vs MIT repo license)
- Remove dead multi-chain scaffolding (`apps/bridge/`, `apps/contracts-sol/`, `apps/contracts-sui/`)
- Governor constants hardcoded for Base L2 2s blocks — escalated to GOV-04 (P2)
- GovernanceERC20.admin and constant `universe = address(0)` are dead/misleading fields — remove (D M-14)
- Trust-model.md references nonexistent functions
- `CreditsPurchasedWithLoar` event desync
- CanonMarketplace tie rejection — no resubmit path
- SIWE `localhost` in prod domains list
- No nonce rate-limit on SIWE endpoint
- Token revocation is memory-only (lost on restart)
- Firestore rules reference `request.auth` but app uses SIWE JWT (dead code)
- Payment verifiers don't check transaction age (amplifies PAY-01)
- Add PausableUpgradeable to 14 revenue contracts lacking it

---

## Unreviewed Contracts (MUST be covered by professional audit)

All of these handle revenue or user assets and have 0% test coverage.
Contracts marked _(partial)_ were touched by Audit D but need full coverage.

| Contract                     | LOC (est) | Risk                        | Coverage                                   |
| ---------------------------- | --------- | --------------------------- | ------------------------------------------ |
| AdPlacement.sol              | ~200      | Medium — holds ad payments  | _(partial)_ — AD-01, AD-02                 |
| SubscriptionManager.sol      | ~300      | High — recurring payments   | _(partial)_ — SUB-01, SUB-02               |
| CollabManager.sol            | ~200      | Medium — splits             | _(partial)_ — COLLAB-01 (E)                |
| LicensingRegistry.sol        | ~250      | High — IP licensing         | _(partial)_ — LICENSE-01, LICENSE-02       |
| ContentLicensing.sol         | ~200      | **High** — licensing fees   | _(partial)_ — CONTENT-01, CONTENT-02 (E)   |
| StoryBounties.sol            | ~300      | High — holds bounty escrow  | _(partial)_ — BOUNTY-01 (E)                |
| SlopMarket.sol               | ~200      | **High** — marketplace      | _(partial)_ — MARKET-01 (E)                |
| StructuralDeed.sol           | ~150      | Medium — metadata+payments  | _(partial)_ — DEED-01, DEED-02 (E)         |
| RemixFees.sol                | ~150      | Medium — fee routing        | _(partial)_ — named in REVENUE-01          |
| LaunchpadStaking.sol         | ~300      | High — holds staked tokens  | _(partial)_ — STAKE-01, STAKE-02           |
| LoarSwapRouter.sol           | ~150      | Medium — swap routing       |                                            |
| LoarBurner.sol               | ~100      | Low — misleading name       | _(partial)_ — BURN-01 (E)                  |
| CharacterNFT.sol             | ~200      | **Critical** — broken proxy | _(partial)_ — NFT-01, ROYALTY-01           |
| EntityNFT.sol                | ~200      | **Critical** — broken proxy | _(partial)_ — NFT-01, NFT-02               |
| EntityEditionNFT.sol         | ~200      | **Critical** — broken proxy | _(partial)_ — NFT-01                       |
| EpisodeNFT.sol               | ~200      | **Critical** — broken proxy | _(partial)_ — NFT-01                       |
| EpisodeEditionCollection.sol | ~200      | **Critical** — broken proxy | _(partial)_ — NFT-01                       |
| CollectiveTokenFactory.sol   | ~150      | Medium — deploys tokens     |                                            |
| IdentityNFT.sol              | ~150      | Medium — soulbound claims   | _(partial)_ — IDENTITY-01, IDENTITY-02 (E) |
| LoarTokenSpoke.sol           | ~200      | High — cross-chain token    | _(partial)_ — SPOKE-01 (E)                 |
| AnalyticsRegistry.sol        | ~200      | Low — analytics             | _(partial)_ — ANALYTICS-01 (E)             |

---

## Recommended Execution Order

### Phase 0: Source Cleanup (Day 1) — NEW

> Before anything else: the auditor and your team must be looking at the same code.

1. **FACTORY-02** — Delete unused Governor/Token variants. Keep exactly one of each.
2. **GOV-06** — Rewrite GovernorFactory to deploy real Governor with TimelockController
3. **GOV-07** — Rewrite GovernanceTokenFactory to deploy real GovernanceERC20 with symbol validation
4. **TOKEN-02 decision** — Remove fee-on-transfer from $LOAR (recommended) OR commit to comprehensive feeExempt plan

### Phase 1: Stop the Bleeding (Week 1)

5. GOV-01 — Deploy Safe + Timelock, transfer all ownership
6. PAY-01 — 3 one-line tx.from checks
7. TOKEN-01 — TOKEN_SUPPLY mismatch (visible day 1)
8. AUTH-02 — Rate limiter fix (one-line)
9. CANON-01 + CANON-02 — Sockpuppet + reentrancy (combined fix)
10. STAKE-01 — Staking lock bypass (zero sophistication exploit)
11. ROYALTY-01 — Remove vestigial claimRoyalties (one function)
12. CONTENT-01 — Add `isMonetizable` check to ContentLicensing (one line)
13. MARKET-01 — SlopMarket must query ERC2981 royaltyInfo before routing

### Phase 2: Fund Safety (Week 2)

14. CANON-03 — Flash-loan voting (requires design decision)
15. CANON-04 — Quorum refund path
16. CREDIT-01 + CREDIT-02 — Rate limits + platform rotation
17. TOKEN-02 — Fee-on-transfer protection (if not removed in Phase 0)
18. TOKEN-03 — Mint cap fix
19. CURVE-01 — Deadline parameter
20. REVENUE-01 — Wire all 5 revenue contracts to read from UniverseManager (systemic)
21. LICENSE-01 — Fix licensor assignment
22. AD-01 — Bid cancellation/expiry
23. SUB-01 — Block tier downgrades or prorate
24. DEED-01 — Universe-ownership check on StructuralDeed mint
25. COLLAB-01 — Ownership verification in CollabManager
26. BOUNTY-01 — Prevent poster rugging accepted winner
27. SPOKE-01 — Port hub safety features to LoarTokenSpoke
28. SPLIT-02 — Add commit-delay to setSplits

### Phase 3: NFT Architecture Rewrite (Weeks 3–4)

29. NFT-01 — Rewrite all 5 NFT contracts to Upgradeable bases (**largest single fix**)
30. GOV-02 — Auto-delegation in GovernanceERC20
31. GOV-03 — Wire symbol blocklist to deployer
32. ESCROW-03 — Dispute resolution multisig
33. RIGHTS-02 — Freeze requires N-of-M consensus

### Phase 4: Integrity (Week 5)

34. RIGHTS-01 — Creator signature requirement
35. UNIVERSE-01 through UNIVERSE-04
36. LOCKER-01 + LOCKER-02
37. HOOK-01
38. AUTH-01, AUTH-03, AUTH-04

### Phase 5: Hardening (Week 6)

39. All P2 items (GOV-04, VESTING-03, HOOK-02, LICENSE-02, STAKE-02, ESCROW-04, DEED-02, TOKEN-04, IDENTITY-01, CREDIT-05, FACTORY-01, etc.)
40. BUILD-01 through BUILD-04
41. Foundry invariant tests
42. Slither + Mythril in CI

### Phase 6: External Audit — TWO PASSES (Weeks 7–16)

43. **Pass 1** (Weeks 7–10): Engage 2 audit firms on pre-fix codebase snapshot
44. Fix audit findings from Pass 1
45. **Pass 2** (Weeks 12–14): Re-audit NFT rewrite (C-7 fixes) + systemic revenue routing changes + factory rewrites — these are large enough to introduce new bugs
46. Public contest (Code4rena / Sherlock)
47. Bug bounty program

### Phase 7: Mainnet (Week 17+)

48. LEGAL-01, LEGAL-02, LEGAL-03
49. Deploy with low TVL cap + functional pause
50. On-chain monitoring (Forta, Defender, Tenderly)
51. Gradual TVL cap increase based on telemetry

---

## Stats

| Severity             | Count                                  | Fixed |
| -------------------- | -------------------------------------- | ----- |
| P0 — Critical        | 15                                     | 0     |
| P1 — High            | 28                                     | 0     |
| P2 — Significant     | 24                                     | 0     |
| P3 — Operational     | 24                                     | 0     |
| P4 — Informational   | 20                                     | 0     |
| **Total**            | **111**                                | **0** |
| Unreviewed contracts | 21 (16 partially covered by Audit D+E) | —     |

_Last updated: 2026-04-17 (Audit E integrated — Pre-Audit Review Part 3)_

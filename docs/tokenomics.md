# $LOAR Tokenomics

> **Status**: Draft scaffold for legal and economic review. All percentages marked TBD require finalization before mainnet launch.
>
> **Last updated**: 2026-04-17
>
> **Network**: Currently deployed on Sepolia / Base Sepolia testnet. Target mainnet is **Base L2** (chain 8453).

---

## 1. Overview

$LOAR is the native utility and governance token for the LOAR platform -- a decentralized AI content creation and narrative governance suite. The token serves four primary functions:

1. **Generation credits**: Pay for AI content generation (images, video, stories) at a reduced margin compared to fiat/ETH payments.
2. **Governance**: Participate in universe-level governance decisions through staking weight and canon marketplace voting.
3. **Staking rewards**: Stake $LOAR globally for platform-wide fee discounts and priority access, or per-universe for pro-rata revenue share.
4. **Premium actions**: Spend $LOAR on platform features such as priority generation queue, permanent canon entries, premium creator profiles, and remix boosts.

The token is implemented as an ERC-20 with ERC-20 Permit (gasless approvals) and `ERC20Burnable` support (any holder — including the DAO treasury — can voluntarily destroy their own supply via `burn()` / `burnFrom()`). There is **no protocol-level auto-burn**: protocol fees (transfer fee, premium actions, staking penalties) route to LP + treasury, not to `address(0)`. Any supply-reducing burn is a deliberate DAO governance action on treasury holdings, not a passive side-effect of usage. See `apps/contracts/src/LoarToken.sol`.

---

## 2. Total Supply and Distribution

**Maximum supply**: 1,000,000,000 (1 billion) $LOAR, with 18 decimal places.

The MAX_SUPPLY cap is enforced via a cumulative `totalMinted` counter that never decreases, even after a voluntary DAO-initiated burn. This means any burned tokens cannot reopen minting headroom — the cap is permanent. Burning is therefore strictly supply-reducing; it cannot be used to circulate fresh issuance.

### Initial Distribution

| Allocation          | Percentage | Tokens      | Recipient                | Purpose                                              |
| ------------------- | ---------- | ----------- | ------------------------ | ---------------------------------------------------- |
| Platform Treasury   | 40%        | 400,000,000 | Treasury multisig        | Rewards, liquidity provisioning, operations          |
| Team / Founder      | 30%        | 300,000,000 | Initial holder (vesting) | Team allocation subject to vesting schedule          |
| Community Rewards   | 20%        | 200,000,000 | Treasury (earmarked)     | Quest rewards, affiliate payouts, creator incentives |
| Future Partnerships | 10%        | 100,000,000 | Treasury (reserved)      | Strategic partnerships, exchange listings, grants    |

> [LEGAL REVIEW REQUIRED] The team/founder allocation vesting terms, lock-up periods, and cliff schedules must be finalized and disclosed before any public token distribution event.

### Post-Launch Allocation Targets

| Category              | Target % | Notes                                               |
| --------------------- | -------- | --------------------------------------------------- |
| Liquidity Pool (LP)   | TBD      | Protocol-owned liquidity on Uniswap v4 (Base)       |
| Creator Allocation    | TBD      | Ongoing creator rewards and bounties                |
| Treasury              | TBD      | DAO-governed operational fund                       |
| Community / Ecosystem | TBD      | Grants, hackathons, ecosystem development           |
| Team                  | TBD      | Subject to vesting (see below)                      |
| Investors             | TBD      | If applicable; subject to separate vesting schedule |

---

## 3. Emission Schedule

### Minting

New $LOAR can only be minted by addresses authorized as `minters` by the contract owner (or the owner itself). Minting is used for:

- Quest completion rewards
- Affiliate payout distribution
- Creator incentive programs

All minting is subject to the permanent MAX_SUPPLY cap of 1 billion tokens. Since `totalMinted` never decreases, the initial distribution already accounts for the full supply -- additional minting is only possible if and when the initial holder or treasury burns tokens, and even then the cap remains enforced against cumulative issuance, not circulating supply.

> [LEGAL REVIEW REQUIRED] Clarify whether additional minting authority constitutes a security risk and whether minter role assignments require governance approval.

### Vesting

The platform includes a `TokenVesting` contract (`apps/contracts/src/TokenVesting.sol`) for linear vesting with cliff periods. Parameters to finalize:

| Parameter              | Value                               |
| ---------------------- | ----------------------------------- |
| Cliff period           | TBD (recommended: 12 months)        |
| Total vesting duration | TBD (recommended: 36-48 months)     |
| Vesting cadence        | Linear (block-by-block after cliff) |
| Early termination      | TBD (revocable vs irrevocable)      |

### Unlock Schedule

| Milestone                    | Event          | Tokens Unlocked                                 |
| ---------------------------- | -------------- | ----------------------------------------------- |
| TGE (Token Generation Event) | Mainnet launch | TBD% of community allocation                    |
| TGE + cliff                  | Cliff expiry   | TBD% of team/investor allocation begins vesting |
| TGE + 12mo                   | Year 1         | TBD                                             |
| TGE + 24mo                   | Year 2         | TBD                                             |
| TGE + 36mo                   | Year 3         | TBD                                             |
| TGE + 48mo                   | Full vest      | 100% of all allocations unlocked                |

> [LEGAL REVIEW REQUIRED] Finalize unlock schedule. Consider regulatory implications of token distribution timing and whether any allocation constitutes an investment contract.

---

## 4. Per-Universe Governance Tokens

Each universe created on LOAR receives its own ERC-20 governance token, deployed via `UniverseTokenDeployerV3`. These are separate from $LOAR and are used for universe-specific governance (canon votes, content direction, treasury decisions).

### Supply per Universe Token

Each universe token has a fixed supply of **1,000,000,000 (1 billion)** tokens with 18 decimals.

### Default Allocation

| Allocation         | Default BPS | Percentage | Constraints                          |
| ------------------ | ----------- | ---------- | ------------------------------------ |
| Bonding Curve (LP) | 8000        | 80%        | Minimum 50% (MIN_LP_BPS = 5000)      |
| Creator            | 1000        | 10%        | Maximum 40% (MAX_CREATOR_BPS = 4000) |
| Platform Treasury  | 500         | 5%         | Minimum 2% (MIN_TREASURY_BPS = 200)  |
| Community          | 500         | 5%         | Remainder after other allocations    |

Creators can customize these splits within the enforced constraints when deploying their universe.

### Price Discovery: Bonding Curve

Universe tokens launch via a bonding curve mechanism (`BondingCurveFactory`). Key parameters:

- **Graduation threshold**: 4 ETH (DEFAULT_GRADUATION_ETH) -- the bonding curve graduates to a full Uniswap pool once this much ETH is deposited.
- **Maximum buy per transaction**: 2% of curve supply (DEFAULT_MAX_BUY_BPS = 200) -- prevents single-actor accumulation during launch.
- **Post-graduation**: Liquidity transitions to a Uniswap v4 pool with protocol-owned liquidity.

### Governance

Each universe token is paired with a Governor contract for on-chain voting (proposal creation, quorum, execution). Token holders vote on canon submissions, content direction, and universe treasury allocation.

> [LEGAL REVIEW REQUIRED] Determine whether per-universe tokens constitute securities under applicable jurisdiction. The bonding curve mechanism and governance rights may trigger registration requirements.

---

## 5. Fee Model

### PaymentRouter

All platform ETH revenue flows through the `PaymentRouter` contract (UUPS upgradeable proxy), which implements a pull-payment pattern:

- **Default platform fee**: Configurable, capped at 50% (5000 bps). Currently initialized at 10% (1000 bps) in deployment scripts.
- **Creator share**: Remainder after platform fee, accrued in the contract and claimable by the creator via `claim()`.
- **Treasury**: Receives platform fee immediately on each `route()` call.

### $LOAR Payment Discount

When users pay in $LOAR instead of ETH, the PaymentRouter applies a fee discount:

- **$LOAR fee discount**: Configurable (initialized at 5% / 500 bps in tests).
- **Effect**: The effective platform fee is reduced when paying in $LOAR, incentivizing token adoption.

### AI Generation Credit Margins

The `CreditManager` contract implements dual-margin pricing for generation credits:

| Payment Method                   | Platform Margin              | Example                              |
| -------------------------------- | ---------------------------- | ------------------------------------ |
| Credit card / ETH / other crypto | 35% (FIAT_MARGIN_BPS = 3500) | 100 credits costs more in ETH        |
| $LOAR token                      | 25% (LOAR_MARGIN_BPS = 2500) | Same 100 credits costs less in $LOAR |

Additionally, purchases made with $LOAR receive a 10% bonus credit on top of package bonus credits.

### Transfer Fee

Every $LOAR transfer (excluding mints, burns, and fee-exempt addresses) incurs a small transfer fee routed to the liquidity pool:

- **Default fee**: 0.01% (1 bps)
- **Hard cap**: 5% (500 bps / MAX_TRANSFER_FEE_BPS)
- **Rate limit on increases**: Maximum +0.1% per change, with 1-day cooldown between changes
- **Exempt addresses**: Treasury, liquidity pool, minters, and any address marked `feeExempt` by the owner

This fee deepens protocol-owned liquidity over time without destroying supply.

### Revenue Streams Summary

| Revenue Source        | Contract            | Platform Take                 | Creator Take                     |
| --------------------- | ------------------- | ----------------------------- | -------------------------------- |
| AI generation credits | CreditManager       | 25-35% margin                 | N/A (platform service)           |
| Episode NFT mints     | EpisodeNFT          | Configurable bps              | Remainder                        |
| Character NFT mints   | CharacterNFT        | Configurable bps              | Remainder + appearance royalties |
| Subscriptions         | SubscriptionManager | Configurable bps              | Remainder                        |
| Canon marketplace     | CanonMarketplace    | Fee on submissions + licenses | Submitter earnings               |
| Content licensing     | ContentLicensing    | Via PaymentRouter splits      | Creator share                    |
| Ad placements         | AdPlacement         | Auction revenue split         | Universe owner share             |
| LP trading fees       | Uniswap v4 hooks    | Hook fees                     | LP providers                     |

---

## 6. Quest and Affiliate Rewards

$LOAR is distributed as rewards for platform engagement:

### Quest Rewards

- Completed via the quest system (on-chain verification)
- Minted by authorized minter addresses
- Subject to MAX_SUPPLY cap (no inflationary minting beyond 1B)

### Affiliate Payouts

- Referral rewards for bringing new users/creators to the platform
- Distributed from the community rewards pool or minted within cap

### Emission Caps

| Parameter                     | Value               |
| ----------------------------- | ------------------- |
| Maximum supply (hard cap)     | 1,000,000,000 $LOAR |
| Daily quest emission cap      | TBD                 |
| Per-quest reward range        | TBD                 |
| Affiliate reward per referral | TBD                 |
| Monthly emission budget       | TBD                 |

> [LEGAL REVIEW REQUIRED] Quest and affiliate reward mechanisms must be reviewed for compliance with promotional regulations and securities law (particularly if rewards are tied to token price appreciation).

---

## 7. LoarBurner: Premium Action Fees

The `LoarBurner` contract (`apps/contracts/src/revenue/LoarBurner.sol`) collects $LOAR for premium platform actions. Despite the name, **no tokens are destroyed** -- all collected $LOAR is redistributed within the ecosystem.

### Premium Actions

| Action              | Default Cost ($LOAR) | Description                                                             |
| ------------------- | -------------------- | ----------------------------------------------------------------------- |
| PRIORITY_GENERATION | 50                   | Skip the AI generation queue                                            |
| PERMANENT_CANON     | 500                  | Make a canon entry immutable (cannot be overturned by governance vote)  |
| PREMIUM_PROFILE     | 1,000                | Verified/premium creator badge                                          |
| REMIX_BOOST         | 100                  | Boost a remix's visibility for 7 days                                   |
| CUSTOM              | Variable             | Platform-defined future actions (extensible via `bytes32` action names) |

### Revenue Split

Collected $LOAR from premium actions is split between LP and treasury:

- **LP portion**: 50% (lpRatioBps = 5000) -- deepens protocol-owned liquidity
- **DAO treasury portion**: 50% -- protocol revenue

The split ratio is configurable by the contract owner.

---

## 8. Staking: LaunchpadStaking

The `LaunchpadStaking` contract (`apps/contracts/src/revenue/LaunchpadStaking.sol`) provides two staking mechanisms:

### Global Tier Staking

Stake $LOAR to unlock platform-wide benefits:

| Tier    | Minimum Stake | Weight     | Fee Discount   | Priority Queue |
| ------- | ------------- | ---------- | -------------- | -------------- |
| Bronze  | 1,000 $LOAR   | 1x (100)   | 1% (100 bps)   | No             |
| Silver  | 10,000 $LOAR  | 3x (300)   | 2.5% (250 bps) | Yes            |
| Gold    | 100,000 $LOAR | 10x (1000) | 5% (500 bps)   | Yes            |
| Diamond | 500,000 $LOAR | 25x (2500) | 10% (1000 bps) | Yes            |

### Per-Universe Staking

Stake $LOAR into a specific universe to earn pro-rata share of:

- Universe trading fees (Uniswap pool fees)
- Subscription revenue
- NFT mint revenue

Revenue share is proportional to your stake relative to total universe stake.

### Staking Economics

| Parameter             | Value                                                   |
| --------------------- | ------------------------------------------------------- |
| Minimum lock period   | 7 days                                                  |
| Early unstake penalty | 5% (500 bps) -- sent to LP, not burned                  |
| Effect on supply      | All staked $LOAR is locked, reducing circulating supply |

> [LEGAL REVIEW REQUIRED] Staking rewards derived from platform revenue may constitute securities. Review whether the staking mechanism creates an investment contract under the Howey test or equivalent local frameworks.

---

## 9. Token Utility Summary

| Utility                   | Mechanism                                                                   | Contract                                 |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| AI generation credits     | Pay with $LOAR at 25% margin (vs 35% for fiat/ETH) + 10% bonus credits      | CreditManager                            |
| Governance voting         | Universe token holders vote on canon, content direction                     | GovernorFactory-deployed governors       |
| Platform fee discount     | $LOAR payments receive configurable bps discount on PaymentRouter fees      | PaymentRouter                            |
| Staking: global tiers     | Stake $LOAR for fee discounts, priority queue, weight multipliers           | LaunchpadStaking                         |
| Staking: universe revenue | Stake into specific universes for pro-rata revenue share                    | LaunchpadStaking                         |
| Premium actions           | Spend $LOAR on priority generation, permanent canon, profiles, boosts       | LoarBurner                               |
| LP yield                  | Provide liquidity in Uniswap v4 pools, earn trading fees via hook mechanism | LoarHookStaticFee + LoarLpLockerMultiple |
| Transfer fee to LP        | 0.01% of all non-exempt transfers routed to liquidity pool                  | LoarToken                                |

---

## 10. Testnet and Mainnet Considerations

### Current State (Testnet)

- $LOAR is deployed on **Sepolia** and **Base Sepolia** testnets
- All token amounts are test tokens with no monetary value
- Contract addresses are listed in `docs/security.md`
- Smart contract test coverage is at 3.65% (see launch audit findings)

### Mainnet Migration (Base L2)

Before mainnet deployment:

- [ ] Complete security audit of all token-related contracts (LoarToken, PaymentRouter, CreditManager, LoarBurner, LaunchpadStaking)
- [ ] Finalize all TBD parameters in this document
- [ ] Legal review of token distribution for securities compliance
- [ ] Migrate from single EOA governance to multi-sig (Gnosis Safe)
- [ ] Add Pausable guards to all revenue contracts
- [ ] Establish token listing and liquidity provision strategy
- [ ] Publish final tokenomics to community before TGE

> [LEGAL REVIEW REQUIRED] This entire document requires review by securities counsel before any public token distribution, listing, or sale. The classification of $LOAR as a utility token vs. security varies by jurisdiction and depends on final implementation details.

---

## Appendix: Contract References

| Contract                | Path                                              | Role                                       |
| ----------------------- | ------------------------------------------------- | ------------------------------------------ |
| LoarToken               | `apps/contracts/src/LoarToken.sol`                | $LOAR ERC-20 token                         |
| PaymentRouter           | `apps/contracts/src/PaymentRouter.sol`            | Revenue routing and fee splits             |
| CreditManager           | `apps/contracts/src/revenue/CreditManager.sol`    | AI generation credit system                |
| LoarBurner              | `apps/contracts/src/revenue/LoarBurner.sol`       | Premium action fee collection              |
| LaunchpadStaking        | `apps/contracts/src/revenue/LaunchpadStaking.sol` | Dual staking (global + per-universe)       |
| TokenVesting            | `apps/contracts/src/TokenVesting.sol`             | Linear vesting with cliff                  |
| UniverseTokenDeployerV3 | `apps/contracts/src/UniverseTokenDeployerV3.sol`  | Per-universe token + governance deployment |

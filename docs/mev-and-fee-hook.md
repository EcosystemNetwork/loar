# MEV & Front-Running Protection

> **Status**: Draft. Audit Pre-Audit Part 1 flagged BondingCurve MEV as a
> HIGH finding. This doc captures mitigations currently in place + what's
> still required before mainnet.
>
> **Last updated**: 2026-04-18

## Threat model

LOAR has three on-chain surfaces where searchers can extract value from users:

1. **BondingCurve buys/sells** — price moves deterministically with supply, so
   a searcher can sandwich a user's buy by front-running it (buy cheap, let
   user fill at higher price, sell back on the same block).
2. **CanonMarketplace votes** — vote price is scaled by current canon weight;
   a searcher can snipe a vote before a governance outcome settles.
3. **Uniswap v4 `LoarFeeHook`** — standard Uniswap MEV applies plus hook-level
   fee revenue that can be arb'd if the hook is swap-path dependent.

Bridges and general DEX MEV are out of scope for this doc.

## Mitigations in place

| Surface          | Mitigation                                       | Where implemented                          | Status                                                                                       |
| ---------------- | ------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| BondingCurve     | Max slippage param on every `buy` / `sell` call  | `BondingCurve.sol` (verify before relying) | **TBD — verify**                                                                             |
| BondingCurve     | Per-address daily cap                            | —                                          | Not implemented                                                                              |
| CanonMarketplace | Snapshot-based vote weight                       | `CanonMarketplace.sol`                     | **TBD — verify snapshot point cannot be gamed**                                              |
| All              | `nonReentrant` on all payable external functions | OZ `ReentrancyGuardUpgradeable`            | In place; audit Part 2 flagged reentrancy in CanonMarketplace as CRITICAL — **fix required** |

## Required before mainnet

- [ ] **Slippage enforcement**: every user-facing entry point that prices
      against a curve (`BondingCurve.buy`, `.sell`, any market-buy path) must
      take a `minOut` / `maxIn` parameter and revert on violation. Current state
      unverified — audit flagged it.
- [ ] **Commit-reveal or batch auction for canon votes**: the current vote
      price is readable before the user's tx lands. Either:
  - Move to a commit-reveal scheme (commit hash → reveal N blocks later), or
  - Batch all votes in a window and clear at a single VWAP price.
    Decision owed from governance team.
- [ ] **Hook fee direction**: confirm the v4 fee hook takes its cut from
      input-side, not output-side. Output-side hooks compound with sandwich
      profits; input-side does not. See Uniswap v4 hook docs.
- [ ] **Private mempool on mainnet**: route admin / treasury transactions
      through Flashbots Protect (or Base's equivalent). Not needed for user txns.
- [ ] **Per-block rate limit** on high-volatility contracts (bonding curve,
      initial token sale). Limits drain-and-dump in a single block.

## Out-of-scope but relevant

- **Oracle manipulation**: if any contract uses a spot AMM as a price feed,
  it becomes MEV-adjacent. Current state: none do, but audit Part 2 flagged
  price-feed risk in CanonMarketplace. Verify before mainnet.
- **Reorgs**: Base has probabilistic finality; payouts should wait N blocks
  (recommend 12) before treating a deposit as final. Currently handled in
  `apps/server/src/services/payment` — verify against mainnet block times.

## How to test

Add tests that model the adversary, not just the happy path:

```solidity
// apps/contracts/test/BondingCurveMEV.t.sol (TODO — create)
function testSandwichAttack() public {
    uint256 victimBuy = 1 ether;
    uint256 searcherFrontrun = 5 ether;
    // 1. Searcher buys 5 ETH worth
    // 2. Victim buys 1 ETH worth (priced against new higher curve)
    // 3. Searcher sells 5 ETH worth
    // Assert: searcher profit ≤ X, victim slippage ≤ 1%
}
```

If that test fails, the fix is slippage enforcement on the victim side — not
rate limits on the attacker side, which a sophisticated searcher will bypass.

## Related docs

- [protocol-take-rate.md](protocol-take-rate.md) — fee catalogue
- [audit-fix-tracker.md](audit-fix-tracker.md) — consolidated audit backlog
- [project_preaudit_review_2026_04_17.md](../.claude/projects/-home-god-Desktop-LOAR-loar/memory/project_preaudit_review_2026_04_17.md) — original BondingCurve MEV finding

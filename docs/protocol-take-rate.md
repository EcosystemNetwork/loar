# Protocol Take Rate

> **Status**: Draft. Specific percentages marked `TBD` must be finalized and approved by legal + finance before mainnet.
>
> **Last updated**: 2026-04-18
>
> **Owner**: founder + finance (when hired)

## Purpose

A single source of truth for every fee LOAR charges. The audit tracker flagged
that fee logic lives only in contract constants and scattered router code; this
doc exists so creators, auditors, and integrators can see the full picture on
one page.

When a fee changes, update this doc in the same PR as the contract/config
change. Drift between doc and code is treated as a P1 issue.

## Fee catalogue

Each row below is one chargeable event. Numbers that are not yet locked in are
marked `TBD`. When a fee is split across multiple recipients (e.g. creator +
treasury + referrer), the split must sum to 100%.

| #   | Event                         | Where charged                            | Gross fee                                                                | Split                                                     | Notes                                                                                                                                                                                                       |
| --- | ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AI generation (fiat / card)   | Stripe → credits                         | **TBD** % on top of Stripe fees                                          | 100% protocol                                             | Billed in credits; margin set against provider cost                                                                                                                                                         |
| 2   | AI generation (crypto)        | `CreditManager` via `PaymentRouter`      | **TBD** % margin                                                         | 100% protocol                                             | See PRD 6 (`project_model_routing.md`) for 30% target margin                                                                                                                                                |
| 3   | Universe mint                 | `UniverseFactory`                        | Fixed price in credits (currently `UNIVERSE_MINT_CREDITS`, default 5000) | 100% protocol                                             | [env-driven](environment.md)                                                                                                                                                                                |
| 4   | NFT primary sale              | `SlopMarketplace.sol`                    | **TBD** %                                                                | Creator / protocol / universe treasury                    | Audit Part 4 flagged `SlopMarket ignores ERC2981` — fix required before this is turned on for external NFTs                                                                                                 |
| 5   | NFT secondary royalty         | ERC-2981 enforcement at marketplace      | **TBD** % (ERC2981 value)                                                | 100% royalty recipient                                    | Off-chain enforcement; on-chain hint only                                                                                                                                                                   |
| 6   | Canon vote (CanonMarketplace) | `CanonMarketplace.sol`                   | **TBD** $LOAR per vote                                                   | 100% treasury (protocol fee, UX framed as "burn")         | Non-refundable voter cost. Routed to treasury via `PaymentRouter`; DAO can later vote to call `burn()` on treasury holdings. No supply destruction at the contract level — keeps quorum denominator stable. |
| 7   | Content licensing             | `ContentLicensing.sol`                   | **TBD** %                                                                | Creator / protocol / rights-holder                        | Pre-Audit Part 3 flagged ContentLicensing skips rights check — fix before fee goes live                                                                                                                     |
| 8   | Bonding-curve buy/sell        | `BondingCurve.sol`                       | **TBD** bps buy, **TBD** bps sell                                        | Split between LP, treasury, and referrer per curve params | MEV protection: see [mev-and-fee-hook.md](mev-and-fee-hook.md)                                                                                                                                              |
| 9   | Uniswap v4 pool fee hook      | `LoarFeeHook.sol`                        | **TBD** bps                                                              | Protocol treasury                                         | Pool swap fee beyond Uniswap's LP fee                                                                                                                                                                       |
| 10  | Staking reward emissions      | `LaunchpadStaking.sol`                   | Not a fee — emission from treasury                                       | —                                                         | Opposite direction; documented for completeness                                                                                                                                                             |
| 11  | Platform subscription         | `platformSubscriptions/` router          | **TBD** USD / month per tier                                             | 100% protocol                                             | See `prd-alpha-02-revenue-loop.md`                                                                                                                                                                          |
| 12  | Quest / affiliate payout      | Off-chain credit grants + on-chain $LOAR | 0 fee (platform pays out)                                                | —                                                         | Documented here so the liability side is visible                                                                                                                                                            |

## Non-fee flows

Things that look like fees but aren't:

- **Gas**: User pays ETH gas to the network; LOAR does not surcharge. Gas
  paymaster (`gas-abstraction.md`) would subsidize gas — that is a protocol
  _cost_, not a fee.
- **IPFS pinning**: Pinata / Lighthouse are subsidized by the protocol from
  treasury. Not billed separately to creators.
- **Refunds**: When a generation fails, credits are refunded at 100%. See
  refund audit in `apps/server/src/lib/refund-audit.ts`.

## How to change a fee

1. Draft the change in a PR that modifies:
   - The contract constant or config entry.
   - The matching row in the table above.
   - The `environment.md` entry if it's env-driven.
2. Post the PR link in the governance channel for treasury sign-off.
3. After merge, run `pnpm smoke` and confirm the smoke harness shows the new
   rate on every affected flow.

## Open questions (block mainnet)

- [ ] Lock numbers for all `TBD` rows. Drives the entire `tokenomics.md`
      revenue projection.
- [x] Canon-vote fee destination decided: 100% treasury (UX framed as "burn"; no contract-level supply destruction — DAO can call `burn()` on treasury holdings later if desired).
- [ ] Settle whether the subscription tier pre-pays a discount against #2 or
      sits orthogonal.
- [ ] Document the accounting treatment of #12 — creator rewards come out of
      the community allocation, but should also appear in the monthly P/L.

## Related docs

- [tokenomics.md](tokenomics.md) — supply / vesting / emission
- [monetization-map.md](monetization-map.md) — creator-facing revenue streams
- [gas-abstraction.md](gas-abstraction.md) — paymaster strategy
- [mev-and-fee-hook.md](mev-and-fee-hook.md) — MEV protection for curves / hook

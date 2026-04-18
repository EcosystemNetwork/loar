# Trust Model & Security Assumptions

> **Scope:** Testnet alpha (Sepolia / Base Sepolia). This document describes the current centralization and trust assumptions. Users should read this before interacting with the contracts or depositing value.

## Contract Ownership (UniverseManager.sol)

The `UniverseManager` contract inherits OpenZeppelin `Ownable`. The **deployer wallet** is the sole owner at launch. There is no multisig, timelock, or on-chain governance over the manager contract itself.

### Owner Powers

| Function                                  | What it does                                                                          | Risk                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `setTokenDeployer(address)`               | Changes which contract is used to deploy universe tokens + governance                 | Owner can swap to a malicious deployer                     |
| `setTeamFeeRecipient(address)`            | Changes where team fees are sent                                                      | Owner can redirect team fees                               |
| `claimTeamFee(token)`                     | Transfers full ERC-20 balance of any token held by the contract to `teamFeeRecipient` | Owner can claim any ERC-20 the contract holds              |
| `claimEth(recipient)`                     | Sends all non-reserved ETH in the contract to any address                             | Owner can claim surplus ETH (but NOT LP-seed ETH)          |
| `setHook(address, bool)`                  | Enables/disables Uniswap v4 hook contracts                                            | Owner controls which hooks are allowed                     |
| `setLocker(address, hook, bool)`          | Enables/disables LP locker contracts per hook                                         | Owner controls which lockers are allowed                   |
| `setMintFee(uint256)`                     | Changes the ETH fee required to create a universe                                     | Owner can change the cost barrier to entry                 |
| `setWeth(address)`                        | Changes the WETH address (locked after first universe creation)                       | One-time; cannot be changed after any universe exists      |
| `setBondingCurveHalted(universeId, bool)` | Emergency halt/resume trading on a universe's bonding curve                           | Owner can freeze trading on any pre-graduation universe    |
| `setDeprecated(bool)`                     | Disables new universe creation                                                        | Owner can freeze new mints (existing universes still work) |

### What the owner CANNOT do

- **Drain LP-seed ETH.** `claimEth` explicitly subtracts `totalLpSeedsHeld` before computing the claimable balance. LP seeds reserved for universe token graduation are protected.
- **Modify existing universes.** Once a `Universe` contract is deployed, its admin is the creator (or the governor after token deployment). The manager cannot change universe state.
- **Mint universe tokens.** Token deployment requires the universe NFT owner to call `deployUniverseToken`. The manager owner cannot deploy tokens on behalf of a universe.
- **Move LP-locked tokens.** Once liquidity is placed via the locker at graduation, neither the manager owner nor the universe admin can withdraw it (locked by the locker contract).
- **Change WETH after first universe.** `setWeth` reverts once `latestId > 0`.

### LP Seed Flow

On universe creation, 100% of the mint fee (default 0.05 ETH) is held in the contract as an LP seed:

- `universeLpSeed[id]` tracks the per-universe seed balance
- `totalLpSeedsHeld` tracks the aggregate (prevents `claimEth` from draining seeds)

When the universe creator calls `deployUniverseToken`, the LP seed is forwarded to the bonding curve as initial reserve ETH. When the bonding curve graduates (hits its target), the raised ETH + unsold tokens are wrapped to WETH and permanently locked in a Uniswap v4 LP position via the locker contract.

There is no credit-fund mechanism in the current contract. Off-chain generation credits are managed entirely in Firestore via the server's CreditManager tRPC router.

## Server-Side Admin

The server uses an `ADMIN_ADDRESSES` environment variable (comma-separated wallet addresses) to gate admin tRPC procedures. Admin powers include:

- Granting credits to any user (`credits.grant`)
- Managing credit packages
- Moderating content (flag/hide/remove)
- Reviewing DMCA takedown requests

This is centralized by design for testnet. There is no on-chain enforcement of server admin permissions.

## Universe-Level Trust

Each universe has a single creator/admin who can:

- Fund the universe credit pool
- Allocate pool credits to team members
- Deposit revenue into the pool
- Set team member allowances
- Manage universe settings

After token deployment, the universe admin role transfers to the deployed Governor contract, enabling on-chain governance for the universe.

Multi-sig support is available via Gnosis Safe — the creator can be a Safe address, and `isUniverseAdmin()` checks Safe ownership on-chain.

## Rate Limiting

The server uses a sliding-window rate limiter with configurable backing store:

- **Default (in-memory):** Suitable for single-process deployments
- **Redis:** Recommended for multi-instance production deployments (set `REDIS_URL`)

IP identification uses `x-forwarded-for` (last hop) or `x-real-ip`. Behind an untrusted proxy, clients could spoof these headers. Configure your reverse proxy to set a trusted forwarded header.

API keys have separate per-key rate limits (configurable, default 60 req/min).

## Payment Verification

All credit purchase paths verify payment before issuing credits:

- **Card (Stripe):** Server retrieves the PaymentIntent from Stripe and confirms `status === 'succeeded'`, matching package and amount.
- **ETH/crypto:** Server fetches the transaction on-chain, confirms success, recipient matches treasury, and amount meets the package minimum.
- **$LOAR token:** Server checks ERC-20 Transfer logs on-chain for the correct token, recipient, and amount.
- **Universe treasury funding:** Same verification as personal purchases.
- **Revenue deposits:** On-chain verification of tx success, recipient, and claimed amount.

## What This Means for Testnet Users

1. **Do not treat testnet as production.** The owner wallet has significant unilateral power over the manager contract.
2. **On-chain assets have real structure but testnet value.** Sepolia/Base Sepolia ETH is free. Universe tokens deployed here are for testing.
3. **Off-chain credit balances are centralized.** Credits live in Firestore, managed by the server. They are not on-chain assets.
4. **The path to decentralization is:** owner → multisig → timelock → on-chain governance. This will happen before mainnet.

## Planned Improvements for Mainnet

- [ ] Transfer `UniverseManager` ownership to a multisig (Gnosis Safe, 3-of-5 minimum)
- [ ] Add a `TimelockController` (48–72h delay) between the multisig and all owned contracts
- [ ] Publish all admin transactions via an on-chain audit log
- [ ] Add `Pausable` to BondingCurve and other value-holding contracts (controlled by timelock)
- [ ] Add on-chain role-based access control to replace single `Ownable`
- [ ] Professional security audit (Trail of Bits / Spearbit / Cantina) before any mainnet deployment
- [ ] Public bug bounty (Immunefi) live before mainnet

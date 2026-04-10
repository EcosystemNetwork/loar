# Trust Model & Security Assumptions

> **Scope:** Testnet alpha (Sepolia / Base Sepolia). This document describes the current centralization and trust assumptions. Users should read this before interacting with the contracts or depositing value.

## Contract Ownership (UniverseManager.sol)

The `UniverseManager` contract inherits OpenZeppelin `Ownable`. The **deployer wallet** is the sole owner at launch. There is no multisig, timelock, or on-chain governance over the manager contract itself.

### Owner Powers

| Function                                | What it does                                                                          | Risk                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `setTokenDeployer(address)`             | Changes which contract is used to deploy universe tokens + governance                 | Owner can swap to a malicious deployer                     |
| `setLpRecipient(address)`               | Changes where the LP half of mint fees (0.025 ETH) is sent                            | Owner can redirect LP fees                                 |
| `setTeamFeeRecipient(address)`          | Changes where team fees are sent                                                      | Owner can redirect team fees                               |
| `claimTeamFee(token)`                   | Transfers full ERC-20 balance of any token held by the contract to `teamFeeRecipient` | Owner can claim any ERC-20 the contract holds              |
| `claimEth(recipient)`                   | Sends all non-reserved ETH in the contract to any address                             | Owner can claim surplus ETH (but NOT credit-fund ETH)      |
| `consumeCreditFund(universeId, amount)` | Marks credit-fund ETH as consumed                                                     | Owner signals off-chain credit conversion completed        |
| `setHook(address, bool)`                | Enables/disables Uniswap v4 hook contracts                                            | Owner controls which hooks are allowed                     |
| `setLocker(address, hook, bool)`        | Enables/disables LP locker contracts per hook                                         | Owner controls which lockers are allowed                   |
| `setDeprecated(bool)`                   | Disables new universe creation                                                        | Owner can freeze new mints (existing universes still work) |

### What the owner CANNOT do

- **Drain credit-fund ETH.** `claimEth` explicitly subtracts `totalCreditFundsHeld` before computing the claimable balance. Universe credit funds are protected.
- **Modify existing universes.** Once a `Universe` contract is deployed, its admin is the creator (or the governor after token deployment). The manager cannot change universe state.
- **Mint universe tokens.** Token deployment requires the universe admin to call `deployUniverseToken`. The manager owner cannot deploy tokens on behalf of a universe.
- **Move LP-locked tokens.** Once liquidity is placed via the locker, neither the manager owner nor the universe admin can withdraw it (locked by the locker contract).

### Credit Fund Flow

On universe creation, the 0.05 ETH mint fee is split:

- 50% (0.025 ETH) → `lpRecipient` (immediate transfer)
- 50% (0.025 ETH) → `universeCreditFund[id]` (held in contract)

Credit funds are reserved on-chain and tracked by `totalCreditFundsHeld`. The platform converts these to off-chain generation credits via `consumeCreditFund`, which the owner calls after crediting the universe's pool in Firestore. This is a trusted off-chain bridge — the owner could consume funds without actually issuing credits (or issue credits without consuming funds).

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

- [ ] Transfer `UniverseManager` ownership to a multisig (Gnosis Safe)
- [ ] Add a timelock contract between the multisig and the manager
- [ ] Publish all admin transactions via an on-chain audit log
- [ ] Move credit-fund conversion to a trustless bridge (e.g., oracle-verified)
- [ ] Add on-chain role-based access control to replace single `Ownable`

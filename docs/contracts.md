# Smart Contract Guide

## Overview

All contracts are in `apps/contracts/src/`, built with [Foundry](https://book.getfoundry.sh/) (Solidity ^0.8.30), and deployed to **Sepolia testnet** (chain 11155111).

Revenue contracts use an **upgradeable proxy architecture**:

- **UUPS Proxy** for singleton contracts (one instance per protocol)
- **Beacon Proxy** for per-universe NFT contracts (one beacon, many proxies)

All upgradeable contracts use OpenZeppelin Upgradeable v5.0.2.

## Deployed Addresses

### Core Protocol

| Contract             | Address                                      | Purpose                             |
| -------------------- | -------------------------------------------- | ----------------------------------- |
| UniverseManager      | `0x7af142BbD14CaEECdA68f948F467Da0257f6B114` | Factory: deploys universes + tokens |
| LoarHookStaticFee    | `0xa66407B5a48C5CbFF4055Ca50f6189575CC2A8cC` | Uniswap v4 fee collection hook      |
| LoarLpLockerMultiple | `0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6` | LP token locking (anti-rug)         |
| LoarFeeLocker        | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` | Fee escrow and creator payouts      |

### Revenue Singletons (UUPS Proxies)

| Contract            | Proxy Address                                | Purpose                                  |
| ------------------- | -------------------------------------------- | ---------------------------------------- |
| PaymentRouter       | `0xD8b49c99aDb51575eea4FB795645fc9e1ce4Fa9C` | Fee splits & treasury routing            |
| RightsRegistry      | `0x711eC315392f6f9FFd37e673B35acc63b9999323` | Content rights & ownership tracking      |
| CanonMarketplace    | `0x8e6c09198267B07E3FC8C66F0343759111D63016` | Canon submission, voting & licensing     |
| CreditManager       | `0x7bB6cDdd392Bf8a6a6E58fd8600B87c8455E8240` | AI generation credits & tiers            |
| AdPlacement         | `0xB18db49DFAB0d8B05916260D457574348893601d` | Ad slot bidding & impressions            |
| SubscriptionManager | `0x99562C96389A91b17662ce5f15143f5b07b84090` | Creator subscription tiers               |
| LicensingRegistry   | `0xE64563E0361f26228783e6cBAd3789563A6d5eA7` | IP licensing (6 types) & royalty splits  |
| CollabManager       | `0xD98755fdEA77Aa76b19DD979f9a3134502D18294` | Multi-creator collaboration management   |
| AnalyticsRegistry   | `0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8` | On-chain analytics & engagement tracking |

### NFT Beacons & Factory

| Contract              | Address                                      | Purpose                            |
| --------------------- | -------------------------------------------- | ---------------------------------- |
| RevenueModuleFactory  | `0x056dDe6c068cE3FE17C2E6eE6cfA8F76eB5A5264` | Deploys 5 NFT proxies per universe |
| EpisodeEdition Beacon | `0xd70A0A63d1F80D6f28BeB3e8f3FC2a34dBEC3618` | ERC1155 episode editions           |
| Character Beacon      | `0xe15D941140e5504AF7C1b56AC14dA236963A99ae` | ERC721 character NFTs              |
| Entity Beacon         | `0x152ADc8350ee69162989c0C52f5ffb2f8A09E17B` | ERC721 entity NFTs                 |
| EntityEdition Beacon  | `0x7e62116B9A889150E6D07830a179f3cF803c2908` | ERC1155 entity editions            |
| EpisodeNFT Beacon     | `0x89c4b520319FDB6cd23cb8DC5E6b023B110F23fC` | ERC721 per-episode NFTs            |

**Owner:** `0x116C28e6DCABCa363f83217C712d79DCE168d90e`

## Contract Architecture

### Core Contracts

#### UniverseManager (Factory)

- **Purpose:** Factory contract that deploys new Universe instances
- **Events:** `UniverseCreated(address universe, address creator)`, `TokenCreated(...)` (14 parameters)
- **Key functions:** Creates universe + governance token + governor in one transaction

#### Universe

- **Purpose:** Individual cinematic universe. Manages narrative nodes as a directed acyclic graph
- **Data model:** Nodes linked by `previousNodeId`, content stored as `bytes32` hashes
- **Key features:** Node creation, content attachment, canonization

#### UniverseTokenDeployer

- **Purpose:** Deploys GovernanceERC20 tokens for each universe
- **Called by:** UniverseManager during universe creation

### Governance

#### GovernanceERC20

- **Purpose:** ERC20 token with built-in voting power (ERC20Votes)
- **Features:** Delegation, vote checkpointing
- **One per universe:** Each cinematic universe gets its own token

#### UniverseGovernor

- **Purpose:** On-chain governance using OpenZeppelin Governor
- **Features:** Proposal creation, voting (for/against/abstain), execution, cancellation
- **Quorum:** Configurable per universe

### Revenue Contracts (UUPS Pattern)

Each singleton revenue contract follows the same pattern:

- Implementation contract with `initialize()` function
- Deployed behind `ERC1967Proxy` with initialization data
- `_authorizeUpgrade(address) internal override onlyOwner {}` restricts upgrades to owner
- Constructor calls `_disableInitializers()` to prevent implementation initialization

| Contract            | Initialize Parameters                                          |
| ------------------- | -------------------------------------------------------------- |
| PaymentRouter       | `(treasury, defaultPlatformFeeBps)`                            |
| RightsRegistry      | `(platform)`                                                   |
| CanonMarketplace    | `(platform, rightsRegistry, paymentRouter, fees..., duration)` |
| CreditManager       | `(loarToken, platform, treasury, paymentRouter)`               |
| AdPlacement         | `(platform, paymentRouter, platformFeeBps)`                    |
| SubscriptionManager | `(platform, paymentRouter, platformFeeBps)`                    |
| LicensingRegistry   | `(platform, paymentRouter, platformFeeBps)`                    |
| CollabManager       | `(platform, paymentRouter, platformFeeBps)`                    |
| AnalyticsRegistry   | `(platform)`                                                   |

### NFT Contracts (Beacon Pattern)

Each NFT type has a shared `UpgradeableBeacon` that points to the current implementation. The `RevenueModuleFactory.deployModules()` creates 5 `BeaconProxy` instances per universe.

| Contract                 | Standard | Initialize Parameters                                                       |
| ------------------------ | -------- | --------------------------------------------------------------------------- |
| EpisodeEditionCollection | ERC1155  | `(universeId, platform, rightsRegistry, paymentRouter, feeBps, royaltyBps)` |
| CharacterNFT             | ERC721   | `(universeId, platform, rightsRegistry, paymentRouter, appearanceFeeBps)`   |
| EntityNFT                | ERC721   | `(universeId, platform, paymentRouter, rightsRegistry, feeBps, royaltyBps)` |
| EntityEditionNFT         | ERC1155  | `(universeId, platform, paymentRouter, rightsRegistry, feeBps, royaltyBps)` |
| EpisodeNFT               | ERC721   | `(platform, rightsRegistry, paymentRouter, feeBps, defaultRoyaltyBps)`      |

### DeFi / Uniswap v4

#### LoarHookStaticFee

- **Purpose:** Uniswap v4 hook implementing static fee logic on swaps

#### LoarFeeLocker

- **Purpose:** Locks and escrows collected trading fees

#### LoarLpLockerMultiple

- **Purpose:** Locks LP tokens for multiple positions (anti-rug guarantee)

### Source Layout

```
src/
├── revenue/            # Revenue module contracts
│   ├── AdPlacement.sol
│   ├── AnalyticsRegistry.sol
│   ├── CanonMarketplace.sol
│   ├── CharacterNFT.sol
│   ├── CollabManager.sol
│   ├── CreditManager.sol
│   ├── EntityEditionNFT.sol
│   ├── EntityNFT.sol
│   ├── EpisodeEditionCollection.sol
│   ├── EpisodeNFT.sol
│   ├── LicensingRegistry.sol
│   └── SubscriptionManager.sol
├── hooks/              # Uniswap v4 hooks (LoarHookStaticFee)
├── interfaces/         # IUniverse, IUniverseManager, ILoarHook, etc.
├── libraries/          # NodeOptions (data structures)
├── lp-lockers/         # LoarLpLockerMultiple, LoarFeeLocker
├── types/              # Custom type definitions
├── utils/              # Utility contracts
├── PaymentRouter.sol   # Fee routing singleton
├── RightsRegistry.sol  # Rights management singleton
├── RevenueModuleFactory.sol  # Per-universe NFT deployer
├── Universe.sol        # DAG narrative contract
├── UniverseManager.sol # Protocol factory
└── UniverseTokenDeployer.sol # Token deployer
```

## Development

### Prerequisites

Install Foundry:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Commands

```bash
# Build contracts
cd apps/contracts
forge build

# Run all tests
forge test -vvv

# Run upgrade tests specifically
forge test --match-path test/Upgrade.t.sol -vvv

# Test coverage
forge coverage --report summary --report lcov --match-path 'test/unit/*'

# Format Solidity code
forge fmt

# Clean build artifacts
forge clean
```

Or use Make targets from the repo root:

```bash
make contracts-build
make contracts-test
make test-coverage
```

### Testing

Tests live in `apps/contracts/test/`:

```bash
# Run all tests
forge test -vvv

# Run upgrade tests (UUPS + Beacon patterns)
forge test --match-path test/Upgrade.t.sol -vvv

# Run a specific test function
forge test --match-test testMyFunction -vvv
```

The upgrade test suite (`test/Upgrade.t.sol`) covers:

- UUPS upgrade preserves state
- UUPS blocks re-initialization
- UUPS blocks non-owner upgrades
- Beacon upgrade propagates to all proxy instances
- Beacon blocks non-owner upgrades

### Deployment

#### Revenue Infrastructure (Full Deploy)

```bash
cd apps/contracts
source ../../.env && export PRIVATE_KEY="0x$PRIVATE_KEY"

forge script script/DeployRevenue.s.sol \
  --rpc-url "$RPC_11155111" \
  --broadcast \
  --skip "script/Deploy{Protocol,Hook,Locker,Universe}*" \
  --sender 0x116C28e6DCABCa363f83217C712d79DCE168d90e
```

This deploys:

1. 5 NFT implementations + 5 UpgradeableBeacons
2. RevenueModuleFactory (receives beacon addresses)
3. 9 UUPS singleton implementations + 9 ERC1967Proxies (initialized)

Broadcast results: `apps/contracts/broadcast/DeployRevenue.s.sol/11155111/run-latest.json`

#### Other Deploy Scripts

| Script                 | Purpose                                |
| ---------------------- | -------------------------------------- |
| `DeployProtocol.s.sol` | Core protocol (UniverseManager, hooks) |
| `DeployUniverse.s.sol` | Deploy a single universe instance      |
| `DeployHook.s.sol`     | Deploy a new Uniswap v4 hook           |
| `DeployLocker.s.sol`   | Deploy a new LP locker                 |

Required env vars:

```env
RPC_11155111=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=<64-char hex, no 0x prefix in .env>
VERIFICATION_KEY_1=YOUR_ETHERSCAN_API_KEY
```

## Upgrading Contracts

### UUPS Singletons

```bash
# 1. Deploy new implementation
forge create src/PaymentRouter.sol:PaymentRouter \
  --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY

# 2. Call upgrade on the proxy (only owner can do this)
cast send <PROXY_ADDRESS> "upgradeToAndCall(address,bytes)" <NEW_IMPL> 0x \
  --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY
```

### Beacon NFTs

```bash
# 1. Deploy new implementation
forge create src/revenue/CharacterNFT.sol:CharacterNFT \
  --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY

# 2. Upgrade beacon — ALL universe instances update at once
cast send <BEACON_ADDRESS> "upgradeTo(address)" <NEW_IMPL> \
  --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY
```

## ABI Generation Pipeline

After changing contracts, regenerate the TypeScript bindings:

```
forge build (Foundry)
    ↓
apps/contracts/out/*.json (ABI JSON files)
    ↓
wagmi generate (wagmi CLI)
    ↓
packages/abis/src/generated.ts (TypeScript hooks + ABIs)
    ↓
Used by apps/web via import from "abis"
```

### Step by step

```bash
# 1. Build contracts
cd apps/contracts && forge build

# 2. Generate wagmi hooks (from repo root)
cd ../..
pnpm exec wagmi generate

# Or use Make:
make contracts-build
make codegen
```

### wagmi.config.ts

The root `wagmi.config.ts` defines which contracts get React hooks generated:

- UniverseTokenDeployer, UniverseManager, Universe
- GovernanceERC20, UniverseGovernor
- LoarLpLockerMultiple, LoarFeeLocker, LoarHookStaticFee
- PaymentRouter, RightsRegistry, RevenueModuleFactory
- CanonMarketplace, CreditManager, AdPlacement
- SubscriptionManager, LicensingRegistry, CollabManager, AnalyticsRegistry
- EpisodeEditionCollection, CharacterNFT, EntityNFT, EntityEditionNFT, EpisodeNFT

Output: `packages/abis/src/generated.ts`

## Ponder Indexer Integration

The indexer (`apps/indexer`) watches these contracts on Sepolia.

### Factory Pattern

1. **UniverseManager** is registered as a factory contract (fixed address)
2. When `UniverseCreated` event fires → Ponder begins tracking the new **Universe** contract
3. When `TokenCreated` event fires → Ponder begins tracking the new **GovernanceERC20** and **UniverseGovernor**

### Indexed Events

| Contract          | Events Indexed                                                        |
| ----------------- | --------------------------------------------------------------------- |
| UniverseManager   | `UniverseCreated`, `TokenCreated`                                     |
| Universe          | `NodeCreated`, `ContentSet`, `NodeCanonized`                          |
| GovernanceERC20   | `Transfer`                                                            |
| UniverseGovernor  | `ProposalCreated`, `VoteCast`, `ProposalExecuted`, `ProposalCanceled` |
| PoolManager       | `Initialize` (pool creation), `Swap`                                  |
| LoarHookStaticFee | `HookEnabled`                                                         |

See `apps/indexer/ponder.config.ts` for the full indexer configuration.

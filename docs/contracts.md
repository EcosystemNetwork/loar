# Smart Contract Guide

## Overview

All contracts are in `apps/contracts/src/`, built with [Foundry](https://book.getfoundry.sh/) (Solidity ^0.8.30), and deployed to **Sepolia testnet** (chain 11155111) with multi-chain support for **Base Sepolia** (84532) and **Base Mainnet** (8453).

Revenue contracts use an **upgradeable proxy architecture**:

- **UUPS Proxy** for singleton contracts (one instance per protocol)
- **Beacon Proxy** for per-universe NFT contracts (one beacon, many proxies)

All upgradeable contracts use OpenZeppelin Upgradeable v5.0.2.

## Deployed Addresses

### Core Protocol

| Contract             | Address                                      | Purpose                             |
| -------------------- | -------------------------------------------- | ----------------------------------- |
| UniverseManager      | `0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce` | Factory: deploys universes + tokens |
| LoarHookStaticFee    | `0x9A53B31b8B4F76Bb617D6B9aAd62731f8033A8Cc` | Uniswap v4 fee collection hook      |
| LoarLpLockerMultiple | `0xc00225D9463C15280748dC2E21D8D8625982Ad54` | LP token locking (anti-rug)         |
| LoarFeeLocker        | `0x1E10b62bd2817d0C2414909027E1E63653fcCd8e` | Fee escrow and creator payouts      |

### Revenue Singletons (UUPS Proxies)

| Contract            | Proxy Address                                | Purpose                                  |
| ------------------- | -------------------------------------------- | ---------------------------------------- |
| PaymentRouter       | `0x920e9A9bac991554AEE2AB7c76c521e5FB3113b6` | Fee splits & treasury routing            |
| RightsRegistry      | `0x3A14A746990498d5a4eCe867db10a197f91856Bc` | Content rights & ownership tracking      |
| CanonMarketplace    | `0xDc5998C5e334345Ac3Aa9a9c6e141f471e929c81` | Canon submission, voting & licensing     |
| CreditManager       | `0x5110FCCaf50316D8F874F22428dC1a832F591639` | AI generation credits & tiers            |
| AdPlacement         | `0x972bD30323B0Fb5f2466E39593cCdE1e8ae3F8C1` | Ad slot bidding & impressions            |
| SubscriptionManager | `0x53542bA1e3445804D9a225C967E2677F017D1d47` | Creator subscription tiers               |
| LicensingRegistry   | `0xbF0Fed6125b1e05aA3Dc52B72B5cd7703990627C` | IP licensing (6 types) & royalty splits  |
| CollabManager       | `0xE981454B4149BEa3a9018fa2ab77482F388ba01f` | Multi-creator collaboration management   |
| AnalyticsRegistry   | `0xB86539C4bf30036B6bd1513320cF38Bc839c7922` | On-chain analytics & engagement tracking |

### NFT Beacons & Factory

| Contract              | Address                                      | Purpose                            |
| --------------------- | -------------------------------------------- | ---------------------------------- |
| RevenueModuleFactory  | `0x6D5CEf09F044224A51bd59EB841769255070e5dA` | Deploys 5 NFT proxies per universe |
| EpisodeEdition Beacon | `0x14742D6BB8eeE513D0D70a235d8B4d801F19F9ed` | ERC1155 episode editions           |
| Character Beacon      | `0x0BEcc54417e9AaC9289C748eb72ECBb55292756f` | ERC721 character NFTs              |
| Entity Beacon         | `0xF951065C7d4d28805188F60a3F8bd398B7776EC8` | ERC721 entity NFTs                 |
| EntityEdition Beacon  | `0xb3D7889c393b710edF2e087Cd2b7148a2556f47b` | ERC1155 entity editions            |
| EpisodeNFT Beacon     | `0x3ebb4FFd384Fc971F445AA950055203916b749a5` | ERC721 per-episode NFTs            |

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

#### UniverseTokenDeployer / UniverseTokenDeployerV2

- **Purpose:** Deploys GovernanceERC20 tokens for each universe
- **Called by:** UniverseManager during universe creation
- **V2 additions:** Allocation config (LP/creator/treasury/community BPS splits), mint fee WETH seeding into LP pool

#### IdentityNFT

- **Purpose:** Creator identity proof minted per universe
- **Features:** Tracks co-creators and multi-sig signers, one NFT per universe creator
- **Minted by:** UniverseManager during `createUniverse()` or `createUniverseWithToken()`

### Governance

#### GovernanceERC20

- **Purpose:** ERC20 token with built-in voting power (ERC20Votes)
- **Features:** Delegation, vote checkpointing
- **One per universe:** Each cinematic universe gets its own token

#### UniverseGovernor

- **Purpose:** On-chain governance using OpenZeppelin Governor
- **Features:** Proposal creation, voting (for/against/abstain), execution, cancellation
- **Quorum:** 10% of supply (configurable per universe)

#### UniverseTimelockGovernor

- **Purpose:** Enhanced governance with TimelockController for safer execution
- **Timelock:** 24-hour delay on proposal execution
- **Parameters:** Voting delay 7200 blocks (~1 day on Base L2), voting period 50400 blocks (~7 days), proposal threshold 1M tokens

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
├── IdentityNFT.sol     # Creator identity NFTs
├── LoarToken.sol       # Platform $LOAR token
├── LoarFaucet.sol      # Testnet faucet
├── LoarSwapRouter.sol  # DEX routing
├── LoarFeeLocker.sol   # Fee escrow
├── PaymentRouter.sol   # Fee routing singleton
├── RightsRegistry.sol  # Rights management singleton
├── SplitRouter.sol     # Revenue split routing
├── RevenueModuleFactory.sol  # Per-universe NFT deployer
├── TokenVesting.sol    # Token vesting schedules
├── Universe.sol        # DAG narrative contract
├── UniverseManager.sol # Protocol factory
├── UniverseGovernor.sol # Standard governor
├── UniverseTimelockGovernor.sol # Governor with timelock
├── UniverseTokenDeployer.sol # Token deployer
├── UniverseTokenDeployerV2.sol # V2 with allocation config
├── GovernanceERC20.sol # Governance token standard
├── ContentLicensing.sol # BUY/RENT/LICENSE deals
├── LaunchpadStaking.sol # $LOAR staking
├── StoryBounties.sol   # Content bounties
├── SlopMarket.sol      # Secondary market
├── CollectiveTokenFactory.sol # Collective tokens
├── StructuralDeed.sol  # Structural deed NFTs
├── LoarBurner.sol      # Token burn mechanism
└── RemixFees.sol       # Remix fee collection
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

# Smart Contract Guide

## Overview

All contracts are in `apps/contracts/src/`, built with [Foundry](https://book.getfoundry.sh/) (Solidity), and deployed to **Sepolia testnet**.

## Contract Architecture

### Core Contracts

#### UniverseManager (Factory)

- **Purpose:** Factory contract that deploys new Universe instances
- **Events:** `UniverseCreated(address universe, address creator)`, `TokenCreated(...)` (14 parameters)
- **Key functions:** Creates universe + governance token + governor in one transaction

#### Universe

- **Purpose:** Individual cinematic universe. Manages narrative nodes
- **Data model:** Nodes form a tree structure linked by `previousNodeId`
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

### DeFi / Uniswap v4

#### LoarHookStaticFee

- **Purpose:** Uniswap v4 hook implementing static fee logic on swaps
- **Interaction:** Attached to Uniswap v4 PoolManager

#### LoarFeeLocker

- **Purpose:** Locks and escrows collected trading fees

#### LoarLpLockerMultiple

- **Purpose:** Locks LP tokens for multiple positions
- **Use case:** Ensuring liquidity is locked for universe tokens

### Libraries & Interfaces

```
src/
├── hooks/          # Uniswap v4 hooks (LoarHookStaticFee)
├── interfaces/     # IUniverse, IUniverseManager, ILoarHook,
│                   # ILoarFeeLocker, ILoarLpLocker, IOwnable, etc.
├── libraries/      # NodeOptions (node data structures)
├── lp-lockers/     # LoarLpLockerMultiple, LoarFeeLocker
├── types/          # Custom type definitions
└── utils/          # Utility contracts
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

# Run tests (verbose)
forge test -vvv

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

Tests live in `apps/contracts/test/`. Foundry tests use Solidity:

```bash
# Run all tests
forge test -vvv

# Run a specific test file
forge test --match-path test/MyContract.t.sol -vvv

# Run a specific test function
forge test --match-test testMyFunction -vvv
```

### Deployment

Deployment scripts are in `apps/contracts/script/`. Broadcast results are stored in `apps/contracts/broadcast/`.

Required env vars:

```env
RPC_11155111=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
VERIFICATION_KEY_1=YOUR_ETHERSCAN_API_KEY
```

```bash
cd apps/contracts
forge script script/Deploy.s.sol --rpc-url $RPC_11155111 --broadcast --verify
```

## ABI Generation Pipeline

After changing contracts, you need to regenerate the TypeScript bindings:

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

- UniverseTokenDeployer
- UniverseManager
- LoarLpLockerMultiple
- Universe
- GovernanceERC20
- UniverseGovernor
- LoarFeeLocker
- LoarHookStaticFee

Output: `packages/abis/src/generated.ts`

The config generates custom hook names in the format `use{ContractName}_{FunctionName}_{type}`.

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

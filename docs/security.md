# Security

> **Status:** Testnet alpha (Sepolia 11155111 / Base Sepolia 84532). No real value is at risk.

This document consolidates LOAR's security posture, deployed contract verification, and the roadmap from testnet to mainnet. For the full trust model, see [trust-model.md](./trust-model.md). For the pre-launch checklist, see [pre-launch-checklist.md](./pre-launch-checklist.md).

---

## Architecture-Level Audit Summary (2026-04-10)

An architecture-level security review found **no critical or high-severity issues**. Key findings:

| Area                 | Status           | Notes                                                              |
| -------------------- | ---------------- | ------------------------------------------------------------------ |
| UUPS Proxy Pattern   | Correct          | Storage gaps, `_disableInitializers()`, `onlyOwner` upgrade guards |
| Beacon Proxy Pattern | Correct          | Shared implementations, owner-gated upgrades                       |
| Role-Based Access    | Present          | `Ownable`, `Pausable` on revenue contracts                         |
| Reentrancy Guards    | Present          | `ReentrancyGuardUpgradeable` on payment paths                      |
| Input Validation     | Present          | Zero-address checks, bounds validation                             |
| Ownership            | Single EOA       | Acceptable for testnet — multisig required before mainnet          |
| Timelock/DAO         | Not yet deployed | Required before mainnet                                            |

## Deployed Contracts

### Ethereum Sepolia (Chain 11155111)

#### Core Protocol

| Contract              | Address                                      | Etherscan                                                                               |
| --------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| UniverseManager       | `0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce` | [View](https://sepolia.etherscan.io/address/0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce) |
| UniverseTokenDeployer | `0xa2556B55C834504b2d71ECa8D1c1295e19D31BEf` | [View](https://sepolia.etherscan.io/address/0xa2556B55C834504b2d71ECa8D1c1295e19D31BEf) |
| LoarToken             | `0xAEC35cAAE68de337711E3bc06b51aaAa5551b63F` | [View](https://sepolia.etherscan.io/address/0xAEC35cAAE68de337711E3bc06b51aaAa5551b63F) |
| LoarHookStaticFee     | `0x9A53B31b8B4F76Bb617D6B9aAd62731f8033A8Cc` | [View](https://sepolia.etherscan.io/address/0x9A53B31b8B4F76Bb617D6B9aAd62731f8033A8Cc) |
| LoarFeeLocker         | `0x1E10b62bd2817d0C2414909027E1E63653fcCd8e` | [View](https://sepolia.etherscan.io/address/0x1E10b62bd2817d0C2414909027E1E63653fcCd8e) |
| LoarLpLockerMultiple  | `0xc00225D9463C15280748dC2E21D8D8625982Ad54` | [View](https://sepolia.etherscan.io/address/0xc00225D9463C15280748dC2E21D8D8625982Ad54) |

#### Revenue Singletons (UUPS Proxies)

| Contract            | Proxy Address                                | Implementation                               | Etherscan                                                                               |
| ------------------- | -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| PaymentRouter       | `0x920e9A9bac991554AEE2AB7c76c521e5FB3113b6` | `0x3991d3f3327F05E36430f021451b700bb101CF4D` | [View](https://sepolia.etherscan.io/address/0x920e9A9bac991554AEE2AB7c76c521e5FB3113b6) |
| RightsRegistry      | `0x3A14A746990498d5a4eCe867db10a197f91856Bc` | `0x82b4Fe50cE07a64CbF5f97E9d70F2cEb8af63EA3` | [View](https://sepolia.etherscan.io/address/0x3A14A746990498d5a4eCe867db10a197f91856Bc) |
| CanonMarketplace    | `0xDc5998C5e334345Ac3Aa9a9c6e141f471e929c81` | `0x2BB4750b79c48E5d39c29b5E88dE05db94a6Ab1F` | [View](https://sepolia.etherscan.io/address/0xDc5998C5e334345Ac3Aa9a9c6e141f471e929c81) |
| CreditManager       | `0x5110FCCaf50316D8F874F22428dC1a832F591639` | `0x511C6A684F8AA68C2e42b2fd7aC94E94270535A9` | [View](https://sepolia.etherscan.io/address/0x5110FCCaf50316D8F874F22428dC1a832F591639) |
| AdPlacement         | `0x972bD30323B0Fb5f2466E39593cCdE1e8ae3F8C1` | `0x5baad71add73e7748f1c1c2b67a2eb4040dceb1c` | [View](https://sepolia.etherscan.io/address/0x972bD30323B0Fb5f2466E39593cCdE1e8ae3F8C1) |
| SubscriptionManager | `0x53542bA1e3445804D9a225C967E2677F017D1d47` | (direct, not proxied)                        | [View](https://sepolia.etherscan.io/address/0x53542bA1e3445804D9a225C967E2677F017D1d47) |
| LicensingRegistry   | `0xbF0Fed6125b1e05aA3Dc52B72B5cd7703990627C` | `0x1485efdd66c5e8cf43bac3ee57e4d50660bc4779` | [View](https://sepolia.etherscan.io/address/0xbF0Fed6125b1e05aA3Dc52B72B5cd7703990627C) |
| CollabManager       | `0xE981454B4149BEa3a9018fa2ab77482F388ba01f` | `0x59695f4b5f4202968317b925eafb786653aae7a0` | [View](https://sepolia.etherscan.io/address/0xE981454B4149BEa3a9018fa2ab77482F388ba01f) |
| AnalyticsRegistry   | `0xB86539C4bf30036B6bd1513320cF38Bc839c7922` | `0x0947ec7ea4bd4509b1b72257cbfdace14d2c9e4a` | [View](https://sepolia.etherscan.io/address/0xB86539C4bf30036B6bd1513320cF38Bc839c7922) |

#### NFT Beacons

| Contract       | Beacon Address                               | Implementation                               | Etherscan                                                                               |
| -------------- | -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| EpisodeEdition | `0x14742D6BB8eeE513D0D70a235d8B4d801F19F9ed` | `0x54ca19957b1fa6114603f2ba0422584063fd2b02` | [View](https://sepolia.etherscan.io/address/0x14742D6BB8eeE513D0D70a235d8B4d801F19F9ed) |
| Character      | `0x0BEcc54417e9AaC9289C748eb72ECBb55292756f` | `0xedd26a1870344789eb7b900875516aedae04d102` | [View](https://sepolia.etherscan.io/address/0x0BEcc54417e9AaC9289C748eb72ECBb55292756f) |
| Entity         | `0xF951065C7d4d28805188F60a3F8bd398B7776EC8` | `0x222604e2185802046692293fd31dcb4bde249bc3` | [View](https://sepolia.etherscan.io/address/0xF951065C7d4d28805188F60a3F8bd398B7776EC8) |
| EntityEdition  | `0xb3D7889c393b710edF2e087Cd2b7148a2556f47b` | `0x6077ce7cb99bfe1ec3c67f8635a597a76e3fbb71` | [View](https://sepolia.etherscan.io/address/0xb3D7889c393b710edF2e087Cd2b7148a2556f47b) |
| EpisodeNFT     | `0x3ebb4FFd384Fc971F445AA950055203916b749a5` | `0x751ed220b082ae763446fe1fd583f3962eebe6a3` | [View](https://sepolia.etherscan.io/address/0x3ebb4FFd384Fc971F445AA950055203916b749a5) |

#### Factory

| Contract             | Address                                      | Etherscan                                                                               |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| RevenueModuleFactory | `0x6D5CEf09F044224A51bd59EB841769255070e5dA` | [View](https://sepolia.etherscan.io/address/0x6D5CEf09F044224A51bd59EB841769255070e5dA) |

### Base Sepolia (Chain 84532)

| Contract              | Address                                      | Etherscan                                                                               |
| --------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| UniverseManager       | `0x46ce7cd72763B784977349686AEa72B84d3F86B6` | [View](https://sepolia.basescan.org/address/0x46ce7cd72763B784977349686AEa72B84d3F86B6) |
| UniverseTokenDeployer | `0xEC9455F29A5a7A2a5F496bB7D4B428A1df3850dF` | [View](https://sepolia.basescan.org/address/0xEC9455F29A5a7A2a5F496bB7D4B428A1df3850dF) |
| LoarToken             | `0x008B6266C10d124B0E8713769C310De802D76a35` | [View](https://sepolia.basescan.org/address/0x008B6266C10d124B0E8713769C310De802D76a35) |
| LoarHookStaticFee     | `0xAC0C66fc1A9daE256ba91797D5B3E4fe4938a8Cc` | [View](https://sepolia.basescan.org/address/0xAC0C66fc1A9daE256ba91797D5B3E4fe4938a8Cc) |
| LoarFeeLocker         | `0x0a66152096f37F83D41c56534022e746B159b052` | [View](https://sepolia.basescan.org/address/0x0a66152096f37F83D41c56534022e746B159b052) |
| LoarLpLockerMultiple  | `0x6FB4b73B1e980217010d20B7DA065b06EA7802B6` | [View](https://sepolia.basescan.org/address/0x6FB4b73B1e980217010d20B7DA065b06EA7802B6) |

**Contract Owner:** `0x116C28e6DCABCa363f83217C712d79DCE168d90e`

---

## Verification Status

To verify all contracts on Etherscan, run from `apps/contracts/`:

```bash
# Sepolia — core protocol
source ../../.env
forge verify-contract 0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce src/UniverseManager.sol:UniverseManager \
  --chain-id 11155111 --etherscan-api-key $VERIFICATION_KEY_1

# Repeat for each contract address above
# See apps/contracts/broadcast/*/11155111/run-latest.json for constructor args
```

Broadcast artifacts containing deployment transactions and constructor arguments:

- `apps/contracts/broadcast/DeployProtocol.s.sol/11155111/run-latest.json`
- `apps/contracts/broadcast/DeployRevenue.s.sol/11155111/run-latest.json`
- `apps/contracts/broadcast/DeployLoarToken.s.sol/11155111/run-latest.json`
- `apps/contracts/broadcast/DeployProtocol.s.sol/84532/run-latest.json`
- `apps/contracts/broadcast/DeployLoarToken.s.sol/84532/run-latest.json`

---

## Test Results (2026-04-10)

```
forge test -vvv
  22 passed, 0 failed

Test Suites:
  HookTest          — 1/1 passed
  UpgradeTest       — 5/5 passed (UUPS + Beacon upgrade coverage)
  UniverseTest      — 16/16 passed (1 fuzz test, 256 runs)
```

### Coverage (2026-04-10)

```
Total line coverage:     3.65% (101/2766)
Total branch coverage:   3.07% (97/3163)
Total function coverage: 4.01% (18/449)
```

Coverage is concentrated on `Universe.sol` and upgrade patterns. Revenue contracts (`src/revenue/`) have **0% coverage** — these need dedicated test suites before mainnet. Run with:

```bash
forge coverage --ir-minimum --report summary
```

(`--ir-minimum` is required due to stack-too-deep in `UniverseManager.sol` when optimizer is disabled.)

---

## Static Analysis

### Slither

Configuration: `apps/contracts/slither.config.json`

```bash
cd apps/contracts
slither . --config-file slither.config.json
```

Filters out `lib/`, `dependencies/`, `test/` directories and informational findings. Includes low-severity and above.

**Note:** Requires `unset VIRTUAL_ENV` if running via pipx, due to solc-select path resolution.

### Results (2026-04-10)

168 contracts analyzed, **136 findings** — all **low severity**. No high or medium issues.

| Category                      | Count | Severity | Action                                                                                                                                                                             |
| ----------------------------- | ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reentrancy (event ordering)   | ~8    | Low      | Events emitted after external calls — no state manipulation risk. Consider reordering for best practice.                                                                           |
| Timestamp comparisons         | ~20   | Low      | Expected for time-based logic (subscriptions, voting deadlines, staking locks). Acceptable.                                                                                        |
| Constant/immutable state vars | ~15   | Low/Gas  | `GovernanceERC20.universe`, `UniverseManager.teamFee` should be `constant`. Several `RevenueModuleFactory` beacon vars and `StructuralDeed` vars should be `immutable`. Saves gas. |

---

## Mainnet Security Requirements

These items MUST be completed before deploying to Base mainnet (chain 8453):

### 1. Professional Audit

- Commission audit from a reputable firm (Cyfrin, SlowMist, Trail of Bits, or similar)
- Estimated lead time: 8-12 weeks
- Publish audit report publicly before enabling mainnet token liquidity
- Budget for remediation sprint after audit findings

### 2. Multisig Ownership

- Deploy Gnosis Safe multisig (minimum 3-of-5 signers)
- Transfer ownership of ALL contracts to the multisig:
  - 9 UUPS proxy contracts
  - 5 UpgradeableBeacon contracts
  - RevenueModuleFactory, UniverseManager, LoarToken
  - LoarFeeLocker, LoarLpLockerMultiple
- Publish multisig address and signer identities

### 3. Timelock Controller

- Deploy OpenZeppelin TimelockController (48-72h delay)
- Set multisig as PROPOSER and EXECUTOR
- Route all ownership functions through timelock
- Verify: no single key can call `upgradeToAndCall`, `setOwner`, or treasury withdrawal

### 4. DAO Governance (Post-Launch)

- Deploy on-chain governance for protocol-level decisions
- Transition from multisig → DAO for upgrade proposals
- Implement voting on fee parameters, new contract deployments

### 5. Bug Bounty

- Establish bug bounty program (Immunefi recommended)
- Scope: all deployed contracts + server-side payment verification
- Reward tiers: Low ($500), Medium ($2,500), High ($10,000), Critical ($50,000+)

---

## Running Security Checks Locally

```bash
cd apps/contracts

# Full test suite
forge test -vvv

# Gas report
forge test --gas-report

# Coverage
forge coverage --report summary --report lcov

# Slither static analysis
slither . --config-file slither.config.json

# Verify a specific contract on Etherscan
forge verify-contract <ADDRESS> <CONTRACT_PATH>:<CONTRACT_NAME> \
  --chain-id <CHAIN_ID> --etherscan-api-key <API_KEY>
```

---

## Reporting Vulnerabilities

If you discover a security vulnerability:

1. **Do NOT** open a public GitHub issue
2. Email security findings to the team directly
3. Include: description, reproduction steps, potential impact
4. We will acknowledge receipt within 48 hours

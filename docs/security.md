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
| UniverseManager       | `0x7af142BbD14CaEECdA68f948F467Da0257f6B114` | [View](https://sepolia.etherscan.io/address/0x7af142BbD14CaEECdA68f948F467Da0257f6B114) |
| UniverseTokenDeployer | `0xE34DAB193105F3d7ec6EE4E6172cbE6213108d8B` | [View](https://sepolia.etherscan.io/address/0xE34DAB193105F3d7ec6EE4E6172cbE6213108d8B) |
| LoarToken             | `0x0A647b3b7426Bce958e7C2FE59f0a89191952C17` | [View](https://sepolia.etherscan.io/address/0x0A647b3b7426Bce958e7C2FE59f0a89191952C17) |
| LoarHookStaticFee     | `0xa66407B5a48C5CbFF4055Ca50f6189575CC2A8cC` | [View](https://sepolia.etherscan.io/address/0xa66407B5a48C5CbFF4055Ca50f6189575CC2A8cC) |
| LoarFeeLocker         | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` | [View](https://sepolia.etherscan.io/address/0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f) |
| LoarLpLockerMultiple  | `0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6` | [View](https://sepolia.etherscan.io/address/0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6) |

#### Revenue Singletons (UUPS Proxies)

| Contract            | Proxy Address                                | Implementation                               | Etherscan                                                                               |
| ------------------- | -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| PaymentRouter       | `0xd8b49c99aDb51575eea4FB795645fc9e1ce4Fa9C` | `0x52b42135703a0b4180f56323e01a75b7186db3f9` | [View](https://sepolia.etherscan.io/address/0xd8b49c99aDb51575eea4FB795645fc9e1ce4Fa9C) |
| RightsRegistry      | `0x711eC315392f6f9FFd37e673B35acc63b9999323` | `0x4ee8a6055270ee5b9cc4132c98cad686bbb08fc4` | [View](https://sepolia.etherscan.io/address/0x711eC315392f6f9FFd37e673B35acc63b9999323) |
| CanonMarketplace    | `0x8e6c09198267B07E3FC8C66F0343759111D63016` | `0x4c617ca52de2d2ca8bb0414f7f1dd0a90a915031` | [View](https://sepolia.etherscan.io/address/0x8e6c09198267B07E3FC8C66F0343759111D63016) |
| CreditManager       | `0x7bB6cDdd392Bf8a6a6E58fd8600B87c8455E8240` | `0x4ce3d82b3ab99ecf404f43aa5167c1e6bf52a3cf` | [View](https://sepolia.etherscan.io/address/0x7bB6cDdd392Bf8a6a6E58fd8600B87c8455E8240) |
| AdPlacement         | `0xB18db49DFAB0d8B05916260D457574348893601d` | `0x5baad71add73e7748f1c1c2b67a2eb4040dceb1c` | [View](https://sepolia.etherscan.io/address/0xB18db49DFAB0d8B05916260D457574348893601d) |
| SubscriptionManager | `0xa6c4bd0256da30780529bf3cf6d78bfedacbcbb9` | (direct, not proxied)                        | [View](https://sepolia.etherscan.io/address/0xa6c4bd0256da30780529bf3cf6d78bfedacbcbb9) |
| LicensingRegistry   | `0xE64563E0361f26228783e6cBAd3789563A6d5eA7` | `0x1485efdd66c5e8cf43bac3ee57e4d50660bc4779` | [View](https://sepolia.etherscan.io/address/0xE64563E0361f26228783e6cBAd3789563A6d5eA7) |
| CollabManager       | `0xD98755fdEA77Aa76b19DD979f9a3134502D18294` | `0x59695f4b5f4202968317b925eafb786653aae7a0` | [View](https://sepolia.etherscan.io/address/0xD98755fdEA77Aa76b19DD979f9a3134502D18294) |
| AnalyticsRegistry   | `0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8` | `0x0947ec7ea4bd4509b1b72257cbfdace14d2c9e4a` | [View](https://sepolia.etherscan.io/address/0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8) |

#### NFT Beacons

| Contract       | Beacon Address                               | Implementation                               | Etherscan                                                                               |
| -------------- | -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| EpisodeEdition | `0xd70A0A63d1F80D6f28BeB3e8f3FC2a34dBEC3618` | `0x54ca19957b1fa6114603f2ba0422584063fd2b02` | [View](https://sepolia.etherscan.io/address/0xd70A0A63d1F80D6f28BeB3e8f3FC2a34dBEC3618) |
| Character      | `0xe15D941140e5504AF7C1b56AC14dA236963A99ae` | `0xedd26a1870344789eb7b900875516aedae04d102` | [View](https://sepolia.etherscan.io/address/0xe15D941140e5504AF7C1b56AC14dA236963A99ae) |
| Entity         | `0x152ADc8350ee69162989c0C52f5ffb2f8A09E17B` | `0x222604e2185802046692293fd31dcb4bde249bc3` | [View](https://sepolia.etherscan.io/address/0x152ADc8350ee69162989c0C52f5ffb2f8A09E17B) |
| EntityEdition  | `0x7e62116B9A889150E6D07830a179f3cF803c2908` | `0x6077ce7cb99bfe1ec3c67f8635a597a76e3fbb71` | [View](https://sepolia.etherscan.io/address/0x7e62116B9A889150E6D07830a179f3cF803c2908) |
| EpisodeNFT     | `0x89c4b520319FDB6cd23cb8DC5E6b023B110F23fC` | `0x751ed220b082ae763446fe1fd583f3962eebe6a3` | [View](https://sepolia.etherscan.io/address/0x89c4b520319FDB6cd23cb8DC5E6b023B110F23fC) |

#### Factory

| Contract             | Address                                      | Etherscan                                                                               |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| RevenueModuleFactory | `0x056dDe6c068cE3FE17C2E6eE6cfA8F76eB5A5264` | [View](https://sepolia.etherscan.io/address/0x056dDe6c068cE3FE17C2E6eE6cfA8F76eB5A5264) |

### Base Sepolia (Chain 84532)

| Contract              | Address                                      | Etherscan                                                                               |
| --------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| UniverseManager       | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` | [View](https://sepolia.basescan.org/address/0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f) |
| UniverseTokenDeployer | `0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6` | [View](https://sepolia.basescan.org/address/0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6) |
| LoarToken             | `0x30A37d04aFa2648FA4427b13c7ca380490F46BaD` | [View](https://sepolia.basescan.org/address/0x30A37d04aFa2648FA4427b13c7ca380490F46BaD) |
| LoarHookStaticFee     | `0x31D8C79D81517a967175E1723d777c6B4AD568CC` | [View](https://sepolia.basescan.org/address/0x31D8C79D81517a967175E1723d777c6B4AD568CC) |
| LoarFeeLocker         | `0xf97b6900f5573cba7dcE4e58e5118b403E098434` | [View](https://sepolia.basescan.org/address/0xf97b6900f5573cba7dcE4e58e5118b403E098434) |
| LoarLpLockerMultiple  | `0x91D581cFdda6F1AC4cA211d8A05B31BeFcEF2882` | [View](https://sepolia.basescan.org/address/0x91D581cFdda6F1AC4cA211d8A05B31BeFcEF2882) |

**Contract Owner:** `0x116C28e6DCABCa363f83217C712d79DCE168d90e`

---

## Verification Status

To verify all contracts on Etherscan, run from `apps/contracts/`:

```bash
# Sepolia — core protocol
source ../../.env
forge verify-contract 0x7af142BbD14CaEECdA68f948F467Da0257f6B114 src/UniverseManager.sol:UniverseManager \
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

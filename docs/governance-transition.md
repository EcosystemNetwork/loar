# Governance Transition: EOA to Multisig + Timelock

## Current State (Testnet)

All LOAR platform contracts are owned by a single deployer EOA (Externally Owned Account). This is acceptable for development and testnet but is a critical security risk for mainnet:

- Single point of failure (lost key = lost control)
- No review period for admin actions
- No multi-party approval for sensitive operations

## Target State (Mainnet)

```
Gnosis Safe (3-of-5 multisig)
    |
    | proposes + executes
    v
TimelockController (48-hour delay)
    |
    | owns
    v
All LOAR Platform Contracts
```

**Key properties:**

- 3-of-5 signing threshold (configurable in Safe)
- 48-hour mandatory delay on all admin actions
- No admin role on TimelockController (immutable roles, no backdoor)
- Safe holds both PROPOSER_ROLE and EXECUTOR_ROLE
- Community can monitor queued transactions during the 48h window

> **Note:** Per-universe contracts already have their own governance via `UniverseTimelockGovernor` + per-universe tokens. This document covers platform-level governance only.

## Contracts Requiring Ownership Transfer

### Core Ownable Contracts (non-upgradeable)

| Contract             | Env Var                  | Ownership Pattern | Key Admin Functions                                                                                            |
| -------------------- | ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| UniverseManager      | `UNIVERSE_MANAGER`       | `Ownable`         | setMintFee, setTokenDeployer, setHook, setLocker, setBondingCurveHalted, setDeprecated, claimEth, claimTeamFee |
| LoarToken            | `LOAR_TOKEN_ADDRESS`     | `Ownable`         | (minting capped at construction)                                                                               |
| IdentityNFT          | `IDENTITY_NFT_ADDRESS`   | `Ownable`         | (minting controlled by UniverseManager)                                                                        |
| LoarFeeLocker        | `FEE_LOCKER_ADDRESS`     | `Ownable`         | withdraw, setFeeRecipient                                                                                      |
| SplitRouter          | `SPLIT_ROUTER_ADDRESS`   | `Ownable`         | (non-upgradeable, routes payments)                                                                             |
| RevenueModuleFactory | `REVENUE_MODULE_FACTORY` | `Ownable`         | setBeacon, setDefaultFees                                                                                      |
| LoarFaucet           | `LOAR_FAUCET_ADDRESS`    | `Ownable`         | withdraw (testnet only)                                                                                        |
| SlopMarket           | `SLOP_MARKET_ADDRESS`    | `Ownable`         | setFees, pause                                                                                                 |

### UUPS Proxy Contracts (OwnableUpgradeable)

These are the most security-sensitive -- the owner can upgrade the implementation contract.

| Contract            | Env Var                        | Key Admin Functions                                                               |
| ------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| PaymentRouter       | `PAYMENT_ROUTER_ADDRESS`       | setTreasury, setDefaultFee, setLoarToken, lockLoarToken, pause/unpause, upgradeTo |
| RightsRegistry      | `RIGHTS_REGISTRY_ADDRESS`      | registerRights, upgradeTo                                                         |
| CanonMarketplace    | `CANON_MARKETPLACE_ADDRESS`    | setFees, pause/unpause, upgradeTo                                                 |
| CreditManager       | `CREDIT_MANAGER_ADDRESS`       | createPackage, setGenerationCost, grantCredits, pause/unpause, upgradeTo          |
| AdPlacement         | `AD_PLACEMENT_ADDRESS`         | setFees, pause/unpause, upgradeTo                                                 |
| SubscriptionManager | `SUBSCRIPTION_MANAGER_ADDRESS` | setFees, pause/unpause, upgradeTo                                                 |
| LicensingRegistry   | `LICENSING_REGISTRY_ADDRESS`   | setFees, pause/unpause, upgradeTo                                                 |
| CollabManager       | `COLLAB_MANAGER_ADDRESS`       | setFees, pause/unpause, upgradeTo                                                 |
| AnalyticsRegistry   | `ANALYTICS_REGISTRY_ADDRESS`   | registerProvider, pause/unpause, upgradeTo                                        |
| LaunchpadStaking    | `LAUNCHPAD_STAKING_ADDRESS`    | setTierConfig, pause/unpause, upgradeTo                                           |
| StoryBounties       | `STORY_BOUNTIES_ADDRESS`       | setFees, pause/unpause, upgradeTo                                                 |
| Escrow              | `ESCROW_ADDRESS`               | resolveDispute, pause/unpause, upgradeTo                                          |
| LoarBurner          | `LOAR_BURNER_ADDRESS`          | setActionCost, setSplit, pause/unpause, upgradeTo                                 |
| RemixFees           | `REMIX_FEES_ADDRESS`           | setDefaultFee, setMinFee, pause/unpause, upgradeTo                                |
| ContentLicensing    | `CONTENT_LICENSING_ADDRESS`    | setFees, pause/unpause, upgradeTo                                                 |

### NFT Beacons (UpgradeableBeacon)

The beacon owner can upgrade the implementation for all beacon proxy instances.

| Beacon                   | Env Var                  | Controls                        |
| ------------------------ | ------------------------ | ------------------------------- |
| EpisodeEditionCollection | `EPISODE_EDITION_BEACON` | All episode edition NFT proxies |
| CharacterNFT             | `CHARACTER_NFT_BEACON`   | All character NFT proxies       |
| EntityNFT                | `ENTITY_NFT_BEACON`      | All entity NFT proxies          |
| EntityEditionNFT         | `ENTITY_EDITION_BEACON`  | All entity edition NFT proxies  |
| EpisodeNFT               | `EPISODE_NFT_BEACON`     | All episode NFT proxies         |

## Step-by-Step Transition Procedure

### Prerequisites

1. Deploy all platform contracts (via `DeployAll.s.sol` or `DeployBase.s.sol`)
2. Create a Gnosis Safe multisig at [app.safe.global](https://app.safe.global):
   - Add 5 signers (team members with hardware wallets preferred)
   - Set threshold to 3-of-5
   - Deploy on Base mainnet
3. Record the Safe address in `.env` as `SAFE_ADDRESS`
4. Ensure the deployer wallet has ETH for gas on Base

### Step 1: Deploy TimelockController

```bash
forge script script/DeployTimelock.s.sol \
  --rpc-url base --broadcast --verify \
  --etherscan-api-key $VERIFICATION_KEY_8453 \
  -vvv
```

Copy the printed `TIMELOCK_ADDRESS` into `.env`.

### Step 2: Dry-Run Ownership Transfer

Verify what will happen without sending any transactions:

```bash
DRY_RUN=true forge script script/TransferToMultisig.s.sol \
  --rpc-url base -vvv
```

Review the output carefully:

- Every contract should show the deployer as `current owner`
- Every contract should show the timelock as `new owner`
- No contracts should be unexpectedly skipped

### Step 3: Execute Ownership Transfer

```bash
forge script script/TransferToMultisig.s.sol \
  --rpc-url base --broadcast --verify -vvv
```

### Step 4: Verify On-Chain

Run the verifier script — it loops every target address in env, calls `owner()`, and asserts the return value equals `TIMELOCK_ADDRESS`. Exits non-zero if any contract is still owned by the deployer EOA (or anything else).

```bash
TIMELOCK_ADDRESS=0x... SAFE_ADDRESS=0x... \
  forge script script/VerifyMultisigTransfer.s.sol --rpc-url base -vv
```

Expected output: every configured contract shows `OK`, summary prints `MISMATCHED: 0`. A non-zero `MISMATCHED` reverts the script with the list of drifting envs.

> **Re-run this periodically** (suggested: weekly CI job) to catch governance drift — e.g. a legitimate Timelock-rotation that left a stale `TIMELOCK_ADDRESS` env, or an unauthorised `OwnershipTransferred` event. See the [governance drift section of the incident response runbook](./incident-response.md#governance-drift--a-contract-is-no-longer-owned-by-the-timelock) for SEV response.

For manual per-contract spot checks:

```bash
cast call $UNIVERSE_MANAGER "owner()(address)" --rpc-url base
# Should return $TIMELOCK_ADDRESS

cast call $TIMELOCK_ADDRESS \
  "hasRole(bytes32,address)(bool)" \
  $(cast keccak "PROPOSER_ROLE") \
  $SAFE_ADDRESS \
  --rpc-url base
# Should return true
```

### Step 5: Test a Timelocked Operation

Verify the full governance flow works by executing a harmless admin call through the Safe:

1. In the Safe UI, create a transaction that calls `TimelockController.schedule()`:
   - target: one of the contracts (e.g., PaymentRouter)
   - data: encoded call to a read-only or no-op admin function
   - value: 0
   - delay: 48 hours (must be >= minDelay)
2. Collect 3-of-5 signatures
3. Execute the `schedule()` call
4. Wait 48 hours
5. Execute the operation via `TimelockController.execute()` from the Safe

## Alternative: Combined Deploy + Transfer (DeployGovernance.s.sol)

For fresh deployments, `DeployGovernance.s.sol` deploys the TimelockController AND transfers all ownership in a single script. Use this when setting up a new environment from scratch:

```bash
forge script script/DeployGovernance.s.sol \
  --rpc-url base --broadcast --verify -vvv
```

## Emergency Procedures

### Emergency Pause (via Safe)

If a vulnerability is discovered, the Safe multisig can pause affected contracts through the TimelockController. However, the 48-hour delay means emergency pauses are NOT instant.

**Mitigation options:**

1. **Pre-schedule emergency pause transactions**: Before they're needed, schedule pause calls with a far-future execution time. If an emergency hits, the Safe can execute immediately (the delay has already passed).

2. **Guardian role** (future enhancement): Add a separate `CANCELLER_ROLE` to the TimelockController held by a dedicated emergency wallet that can cancel queued malicious proposals. This does NOT bypass the timelock for new actions.

3. **For contracts already paused by the deployer** (AdPlacement, LicensingRegistry, CollabManager): These remain paused until the timelock owner explicitly unpauses them.

### If Safe Signers Are Compromised

1. The 48-hour timelock delay gives the community time to notice malicious proposals
2. Other Safe signers can reject the proposal (requires threshold not met)
3. If the TimelockController had a CANCELLER_ROLE assigned, it could cancel queued operations
4. As a last resort: affected users can withdraw funds during the 48h window

### If TimelockController Has a Bug

The TimelockController is OpenZeppelin's battle-tested `TimelockController.sol` (v5.0.2). In the unlikely event of a bug:

1. OpenZeppelin would issue a security advisory
2. Since the timelock owns itself via the Safe, the Safe can schedule an upgrade or migration
3. The 48-hour delay applies to this migration too -- giving time for community review

## Verification Checklist

After completing the transition, verify each item:

- [ ] TimelockController deployed and verified on BaseScan
- [ ] `PROPOSER_ROLE` granted only to Safe multisig
- [ ] `EXECUTOR_ROLE` granted only to Safe multisig
- [ ] `DEFAULT_ADMIN_ROLE` not held by any address (renounced)
- [ ] `minDelay` is 172800 (48 hours)
- [ ] All core Ownable contracts: `owner()` returns TimelockController address
- [ ] All UUPS proxies: `owner()` returns TimelockController address
- [ ] All NFT beacons: `owner()` returns TimelockController address
- [ ] Deployer EOA no longer owns any contracts
- [ ] Test timelocked operation completes successfully end-to-end
- [ ] Safe transaction history shows the test proposal + execution
- [ ] Block explorer shows ownership transfer events for all contracts

## Architecture Diagram

```
                    +-------------------+
                    |   Gnosis Safe     |
                    |   (3-of-5)        |
                    +--------+----------+
                             |
                    schedule / execute
                             |
                    +--------v----------+
                    | TimelockController |
                    |  (48h delay)       |
                    +--------+----------+
                             |
              transferOwnership() was called
              on every contract below:
                             |
         +-------------------+-------------------+
         |                   |                   |
   +-----v------+    +------v------+    +-------v-------+
   | Core        |    | UUPS        |    | NFT Beacons   |
   | (Ownable)   |    | Proxies     |    | (Ownable)     |
   |             |    | (Ownable-   |    |               |
   | Manager     |    |  Upgradeable|    | Episode Ed.   |
   | LoarToken   |    |             |    | CharacterNFT  |
   | IdentityNFT |    | PaymentRtr  |    | EntityNFT     |
   | FeeLocker   |    | RightsReg   |    | EntityEd.     |
   | SplitRouter |    | Canon Mkt   |    | EpisodeNFT    |
   | RevFactory  |    | CreditMgr   |    +---------------+
   | LoarFaucet  |    | AdPlace     |
   | SlopMarket  |    | SubMgr      |
   +-------------+    | LicenseReg  |
                      | CollabMgr   |
                      | Analytics   |
                      | Staking     |
                      | Bounties    |
                      | Escrow      |
                      | LoarBurner  |
                      | RemixFees   |
                      | ContentLic  |
                      +-------------+

   Per-universe contracts have SEPARATE governance:
   UniverseTimelockGovernor + universe token voting
   (not affected by this platform-level transition)
```

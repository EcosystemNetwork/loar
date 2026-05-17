// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";

/**
 * @title TransferToMultisig
 * @notice Transfers ownership of ALL platform Ownable / OwnableUpgradeable contracts
 *         to an already-deployed TimelockController, which is governed by a Safe multisig.
 *
 * Supports two modes:
 *   - LIVE MODE (default): actually broadcasts ownership transfer transactions
 *   - DRY-RUN MODE (DRY_RUN=true): logs what WOULD happen without sending any transactions
 *
 * Prerequisites:
 *   - TimelockController already deployed (via DeployTimelock.s.sol)
 *   - Safe multisig already holds PROPOSER_ROLE + EXECUTOR_ROLE on the TimelockController
 *   - Deployer wallet is the current owner of all contracts being transferred
 *
 * Governance chain after transfer:
 *   Safe multisig proposes -> TimelockController (48h delay) -> contract ownership
 *
 * Environment variables:
 *   PRIVATE_KEY             - Current owner private key
 *   SAFE_ADDRESS            - Gnosis Safe multisig address (for verification)
 *   TIMELOCK_ADDRESS        - Already-deployed TimelockController address
 *   DRY_RUN                 - Set to "true" for dry-run mode (default: false)
 *
 *   Core Ownable contracts (non-upgradeable):
 *     UNIVERSE_MANAGER          - UniverseManager (ERC721 + factory)
 *     LOAR_TOKEN_ADDRESS        - LoarToken (ERC20)
 *     IDENTITY_NFT_ADDRESS      - IdentityNFT (ERC721 for co-creators)
 *     FEE_LOCKER_ADDRESS        - LoarFeeLocker
 *     SPLIT_ROUTER_ADDRESS      - SplitRouter
 *     REVENUE_MODULE_FACTORY    - RevenueModuleFactory
 *     LOAR_FAUCET_ADDRESS       - LoarFaucet (testnet)
 *     SLOP_MARKET_ADDRESS       - SlopMarket (secondary NFT market)
 *
 *   UUPS proxy addresses (OwnableUpgradeable):
 *     PAYMENT_ROUTER_ADDRESS           - PaymentRouter
 *     RIGHTS_REGISTRY_ADDRESS          - RightsRegistry
 *     CANON_MARKETPLACE_ADDRESS        - CanonMarketplace
 *     CREDIT_MANAGER_ADDRESS           - CreditManager
 *     AD_PLACEMENT_ADDRESS             - AdPlacement
 *     SUBSCRIPTION_MANAGER_ADDRESS     - SubscriptionManager
 *     LICENSING_REGISTRY_ADDRESS       - LicensingRegistry
 *     COLLAB_MANAGER_ADDRESS           - CollabManager
 *     ANALYTICS_REGISTRY_ADDRESS       - AnalyticsRegistry
 *     LAUNCHPAD_STAKING_ADDRESS        - LaunchpadStaking
 *     STORY_BOUNTIES_ADDRESS           - StoryBounties
 *     ESCROW_ADDRESS                   - Escrow
 *     LOAR_BURNER_ADDRESS              - PremiumActions (legacy env-var name from pre-BURN-01 rename)
 *     REMIX_FEES_ADDRESS               - RemixFees
 *     CONTENT_LICENSING_ADDRESS        - ContentLicensing
 *
 *   NFT beacon addresses (UpgradeableBeacon / Ownable):
 *     EPISODE_EDITION_BEACON    - EpisodeEditionCollection beacon
 *     CHARACTER_NFT_BEACON      - CharacterNFT beacon
 *     ENTITY_NFT_BEACON         - EntityNFT beacon
 *     ENTITY_EDITION_BEACON     - EntityEditionNFT beacon
 *     EPISODE_NFT_BEACON        - EpisodeNFT beacon
 *
 * Run (dry-run):
 *   DRY_RUN=true forge script script/TransferToMultisig.s.sol \
 *     --rpc-url base -vvv
 *
 * Run (live):
 *   forge script script/TransferToMultisig.s.sol \
 *     --rpc-url base --broadcast --verify -vvv
 */
contract TransferToMultisigScript is Script {
    uint256 transferred;
    uint256 skipped;
    bool dryRun;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address safe = vm.envAddress("SAFE_ADDRESS");
        address timelockAddr = vm.envAddress("TIMELOCK_ADDRESS");
        dryRun = vm.envOr("DRY_RUN", false);

        require(safe != address(0), "SAFE_ADDRESS must not be zero");
        require(timelockAddr != address(0), "TIMELOCK_ADDRESS must not be zero");

        console.log("=== Transfer Ownership to Timelock ===");
        console.log(
            "Mode:", dryRun ? "DRY RUN (no transactions)" : "LIVE (broadcasting transactions)"
        );
        console.log("Current owner:", deployer);
        console.log("Safe multisig:", safe);
        console.log("TimelockController:", timelockAddr);
        console.log("");

        // ── Verify TimelockController roles ────────────────────────
        TimelockController timelock = TimelockController(payable(timelockAddr));
        bytes32 proposerRole = timelock.PROPOSER_ROLE();
        bytes32 executorRole = timelock.EXECUTOR_ROLE();
        bytes32 adminRole = timelock.DEFAULT_ADMIN_ROLE();

        bool safeIsProposer = timelock.hasRole(proposerRole, safe);
        bool safeIsExecutor = timelock.hasRole(executorRole, safe);
        bool noAdmin = !timelock.hasRole(adminRole, deployer) && !timelock.hasRole(adminRole, safe)
            && !timelock.hasRole(adminRole, timelockAddr);

        console.log("--- TimelockController Role Verification ---");
        console.log("  Safe has PROPOSER_ROLE:", safeIsProposer ? "YES" : "NO");
        console.log("  Safe has EXECUTOR_ROLE:", safeIsExecutor ? "YES" : "NO");
        console.log("  Admin role renounced:", noAdmin ? "YES" : "NO");
        console.log("  Min delay:", timelock.getMinDelay(), "seconds");
        console.log("");

        require(safeIsProposer, "Safe does not have PROPOSER_ROLE on TimelockController");
        require(safeIsExecutor, "Safe does not have EXECUTOR_ROLE on TimelockController");

        if (!dryRun) {
            vm.startBroadcast(pk);
        }

        // ── Core Ownable contracts (non-upgradeable) ───────────────
        console.log("--- Core Ownable Contracts ---");
        _transferOwnable("UNIVERSE_MANAGER", timelockAddr);
        _transferOwnable("LOAR_TOKEN_ADDRESS", timelockAddr);
        _transferOwnable("IDENTITY_NFT_ADDRESS", timelockAddr);
        _transferOwnable("FEE_LOCKER_ADDRESS", timelockAddr);
        _transferOwnable("SPLIT_ROUTER_ADDRESS", timelockAddr);
        _transferOwnable("REVENUE_MODULE_FACTORY", timelockAddr);
        _transferOwnable("LOAR_FAUCET_ADDRESS", timelockAddr);
        _transferOwnable("SLOP_MARKET_ADDRESS", timelockAddr);

        // ── UUPS proxy contracts (OwnableUpgradeable) ──────────────
        console.log("\n--- UUPS Proxy Contracts ---");
        _transferOwnableUpgradeable("PAYMENT_ROUTER_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("RIGHTS_REGISTRY_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("CANON_MARKETPLACE_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("CREDIT_MANAGER_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("AD_PLACEMENT_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("SUBSCRIPTION_MANAGER_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("LICENSING_REGISTRY_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("COLLAB_MANAGER_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("ANALYTICS_REGISTRY_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("LAUNCHPAD_STAKING_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("STORY_BOUNTIES_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("TALENT_AGENT_REGISTRY_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("ESCROW_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("LOAR_BURNER_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("REMIX_FEES_ADDRESS", timelockAddr);
        _transferOwnableUpgradeable("CONTENT_LICENSING_ADDRESS", timelockAddr);

        // ── NFT beacons (UpgradeableBeacon / Ownable) ──────────────
        console.log("\n--- NFT Beacons ---");
        _transferBeacon("EPISODE_EDITION_BEACON", timelockAddr);
        _transferBeacon("CHARACTER_NFT_BEACON", timelockAddr);
        _transferBeacon("ENTITY_NFT_BEACON", timelockAddr);
        _transferBeacon("ENTITY_EDITION_BEACON", timelockAddr);
        _transferBeacon("EPISODE_NFT_BEACON", timelockAddr);

        if (!dryRun) {
            vm.stopBroadcast();
        }

        // ── Summary ─────────────────────────────────────────────────
        console.log("");
        console.log("========================================");
        if (dryRun) {
            console.log("  DRY RUN COMPLETE - NO TRANSACTIONS SENT");
        } else {
            console.log("  OWNERSHIP TRANSFER COMPLETE");
        }
        console.log("========================================");
        console.log("Transferred:", transferred);
        console.log("Skipped (not set):", skipped);
        console.log("New owner:", timelockAddr);
        console.log("Controlled by Safe:", safe);
        console.log("");
        if (!dryRun) {
            console.log("IMPORTANT: Verify all transfers on-chain:");
            console.log("  - For each contract, call owner() and confirm it returns the timelock");
            console.log("  - Run this script again with DRY_RUN=true to re-verify");
        } else {
            console.log("To execute for real, run without DRY_RUN=true:");
            console.log("  forge script script/TransferToMultisig.s.sol \\");
            console.log("    --rpc-url base --broadcast --verify -vvv");
        }
        console.log("========================================");
    }

    // ── Internal helpers ────────────────────────────────────────

    /// @dev Transfer ownership of a non-upgradeable Ownable contract.
    function _transferOwnable(string memory envKey, address newOwner) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP  ", envKey, " (env not set)"));
            skipped++;
            return;
        }

        if (dryRun) {
            address currentOwner = Ownable(addr).owner();
            console.log(string.concat("  [DRY] ", envKey));
            console.log("         addr:", addr);
            console.log("         current owner:", currentOwner);
            console.log("         new owner:", newOwner);
            transferred++;
            return;
        }

        Ownable(addr).transferOwnership(newOwner);
        console.log(string.concat("  OK    ", envKey, " -> timelock"));
        transferred++;
    }

    /// @dev Transfer ownership of a UUPS proxy (OwnableUpgradeable).
    function _transferOwnableUpgradeable(string memory envKey, address newOwner) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP  ", envKey, " (env not set)"));
            skipped++;
            return;
        }

        if (dryRun) {
            address currentOwner = OwnableUpgradeable(addr).owner();
            console.log(string.concat("  [DRY] ", envKey));
            console.log("         addr:", addr);
            console.log("         current owner:", currentOwner);
            console.log("         new owner:", newOwner);
            transferred++;
            return;
        }

        OwnableUpgradeable(addr).transferOwnership(newOwner);
        console.log(string.concat("  OK    ", envKey, " -> timelock"));
        transferred++;
    }

    /// @dev Transfer ownership of an UpgradeableBeacon.
    function _transferBeacon(string memory envKey, address newOwner) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP  ", envKey, " (env not set)"));
            skipped++;
            return;
        }

        if (dryRun) {
            address currentOwner = UpgradeableBeacon(addr).owner();
            console.log(string.concat("  [DRY] ", envKey));
            console.log("         addr:", addr);
            console.log("         current owner:", currentOwner);
            console.log("         new owner:", newOwner);
            transferred++;
            return;
        }

        UpgradeableBeacon(addr).transferOwnership(newOwner);
        console.log(string.concat("  OK    ", envKey, " -> timelock"));
        transferred++;
    }
}

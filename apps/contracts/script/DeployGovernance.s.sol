// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";

/**
 * @title DeployGovernance (GOV-01)
 * @notice Deploys a platform-level TimelockController governed by a Gnosis Safe
 *         multisig, then transfers ownership of all deployed UUPS proxies and
 *         NFT beacons to the timelock.
 *
 * ============================================================================
 * PREREQUISITE: Deploy a Gnosis Safe multisig FIRST via the Safe UI at
 * https://safe.global. Choose Base mainnet, set your desired signers and
 * threshold (e.g. 3-of-5), then paste the deployed Safe address into
 * SAFE_ADDRESS in your .env file. This script deploys the TimelockController
 * and then transfers all contract ownership to it.
 *
 * After this script completes, the governance chain is:
 *
 *   Safe multisig (propose) -> TimelockController (48h delay) -> execute
 *
 * The Safe proposes operations on the timelock. After the 48-hour delay,
 * the Safe can execute them. The deployer retains NO admin privileges.
 * ============================================================================
 *
 * Environment variables:
 *   PRIVATE_KEY             - Deployer / current owner key
 *   SAFE_ADDRESS            - Gnosis Safe multisig address (proposer + executor)
 *
 *   UUPS proxy addresses (all OwnableUpgradeable):
 *     PAYMENT_ROUTER_PROXY
 *     CANON_MARKETPLACE_PROXY
 *     CREDIT_MANAGER_PROXY
 *     SUBSCRIPTION_MANAGER_PROXY
 *     LICENSING_REGISTRY_PROXY
 *     COLLAB_MANAGER_PROXY
 *     AD_PLACEMENT_PROXY
 *     ANALYTICS_REGISTRY_PROXY
 *     RIGHTS_REGISTRY_PROXY
 *     ESCROW_PROXY
 *     LAUNCHPAD_STAKING_PROXY
 *
 *   Additional UUPS contracts (transferred if env vars are set):
 *     STORY_BOUNTIES_PROXY
 *     LOAR_BURNER_PROXY            (PremiumActions proxy; env-var name retained from pre-BURN-01 rename)
 *     REMIX_FEES_PROXY
 *     CONTENT_LICENSING_PROXY
 *
 *   Core Ownable contracts (non-upgradeable, transferred if set):
 *     UNIVERSE_MANAGER
 *     LOAR_TOKEN_ADDRESS
 *     IDENTITY_NFT_ADDRESS
 *     FEE_LOCKER_ADDRESS
 *     SPLIT_ROUTER_ADDRESS
 *     REVENUE_MODULE_FACTORY
 *     SLOP_MARKET_ADDRESS
 *     LOAR_FAUCET_ADDRESS
 *
 *   NFT beacon addresses (UpgradeableBeacon / Ownable, transferred if set):
 *     EPISODE_EDITION_BEACON
 *     CHARACTER_NFT_BEACON
 *     ENTITY_NFT_BEACON
 *     ENTITY_EDITION_BEACON
 *     EPISODE_NFT_BEACON
 *
 * Run:
 *   forge script script/DeployGovernance.s.sol \
 *     --rpc-url base --broadcast --verify -vvv
 */
contract DeployGovernanceScript is Script {
    /// @notice 48-hour minimum delay for all timelocked operations
    uint256 constant MIN_DELAY = 48 hours;

    uint256 transferred;
    uint256 skipped;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address safe = vm.envAddress("SAFE_ADDRESS");

        require(safe != address(0), "SAFE_ADDRESS must not be zero");

        console.log("=== LOAR Governance Deployment (GOV-01) ===");
        console.log("Deployer:", deployer);
        console.log("Safe multisig:", safe);
        console.log("Timelock delay:", MIN_DELAY, "seconds (48 hours)");

        vm.startBroadcast(pk);

        // ── Step 1: Deploy TimelockController ──────────────────────
        //
        // Proposers: only the Safe multisig can propose timelocked operations
        // Executors: only the Safe multisig can execute after the delay
        // Admin: address(0) - admin is renounced immediately, no backdoor.
        //        The timelock's roles cannot be changed after deployment.
        address[] memory proposers = new address[](1);
        proposers[0] = safe;
        address[] memory executors = new address[](1);
        executors[0] = safe;

        TimelockController timelock = new TimelockController(
            MIN_DELAY,
            proposers,
            executors,
            address(0) // no admin - immutable roles
        );
        address timelockAddr = address(timelock);
        console.log("[1] TimelockController deployed:", timelockAddr);

        // ── Step 2: Transfer UUPS proxy ownership to timelock ──────
        //
        // These are the 11 core revenue/platform UUPS proxies. Each uses
        // OwnableUpgradeable, so transferOwnership() updates both the
        // admin slot (for upgrades) and the access control owner.
        console.log("\n--- Transferring UUPS proxy ownership ---");

        transferOwnership(timelockAddr);

        // ── Step 3: Transfer additional UUPS contracts ─────────────
        console.log("\n--- Transferring additional UUPS contracts ---");

        _transferUUPS("STORY_BOUNTIES_PROXY", timelockAddr);
        _transferUUPS("TALENT_AGENT_REGISTRY_PROXY", timelockAddr);
        _transferUUPS("LOAR_BURNER_PROXY", timelockAddr);
        _transferUUPS("REMIX_FEES_PROXY", timelockAddr);
        _transferUUPS("CONTENT_LICENSING_PROXY", timelockAddr);

        // ── Step 4: Transfer core Ownable contracts ────────────────
        console.log("\n--- Transferring core Ownable contracts ---");

        _transferOwnable("UNIVERSE_MANAGER", timelockAddr);
        _transferOwnable("LOAR_TOKEN_ADDRESS", timelockAddr);
        _transferOwnable("IDENTITY_NFT_ADDRESS", timelockAddr);
        _transferOwnable("FEE_LOCKER_ADDRESS", timelockAddr);
        _transferOwnable("SPLIT_ROUTER_ADDRESS", timelockAddr);
        _transferOwnable("REVENUE_MODULE_FACTORY", timelockAddr);
        _transferOwnable("SLOP_MARKET_ADDRESS", timelockAddr);
        _transferOwnable("LOAR_FAUCET_ADDRESS", timelockAddr);

        // ── Step 5: Transfer NFT beacon ownership ──────────────────
        console.log("\n--- Transferring beacon ownership ---");

        _transferBeacon("EPISODE_EDITION_BEACON", timelockAddr);
        _transferBeacon("CHARACTER_NFT_BEACON", timelockAddr);
        _transferBeacon("ENTITY_NFT_BEACON", timelockAddr);
        _transferBeacon("ENTITY_EDITION_BEACON", timelockAddr);
        _transferBeacon("EPISODE_NFT_BEACON", timelockAddr);

        vm.stopBroadcast();

        // ── Summary ─────────────────────────────────────────────────
        console.log("\n========================================");
        console.log("  GOV-01 GOVERNANCE DEPLOYMENT COMPLETE");
        console.log("========================================");
        console.log("TimelockController:", timelockAddr);
        console.log("Safe (proposer + executor):", safe);
        console.log("Admin: renounced (address(0))");
        console.log("Min delay: 48 hours");
        console.log("Transferred:", transferred);
        console.log("Skipped:", skipped);
        console.log("");
        console.log("Add to .env:");
        console.log(string.concat("TIMELOCK_ADDRESS=", vm.toString(timelockAddr)));
        console.log("");
        console.log("Verify on BaseScan:");
        console.log("  1. TimelockController roles are correct");
        console.log("  2. Each contract's owner() returns the timelock address");
        console.log("  3. Deployer wallet has NO remaining ownership");
        console.log("========================================");
    }

    /// @notice Transfers ownership of the 11 core UUPS proxy contracts to the
    ///         timelock. This is the main GOV-01 requirement. Each contract
    ///         address is read from an env var with the _PROXY suffix.
    function transferOwnership(address timelockAddr) public {
        _transferUUPS("PAYMENT_ROUTER_PROXY", timelockAddr);
        _transferUUPS("CANON_MARKETPLACE_PROXY", timelockAddr);
        _transferUUPS("CREDIT_MANAGER_PROXY", timelockAddr);
        _transferUUPS("SUBSCRIPTION_MANAGER_PROXY", timelockAddr);
        _transferUUPS("LICENSING_REGISTRY_PROXY", timelockAddr);
        _transferUUPS("COLLAB_MANAGER_PROXY", timelockAddr);
        _transferUUPS("AD_PLACEMENT_PROXY", timelockAddr);
        _transferUUPS("ANALYTICS_REGISTRY_PROXY", timelockAddr);
        _transferUUPS("RIGHTS_REGISTRY_PROXY", timelockAddr);
        _transferUUPS("ESCROW_PROXY", timelockAddr);
        _transferUUPS("LAUNCHPAD_STAKING_PROXY", timelockAddr);
    }

    // ── Internal helpers ────────────────────────────────────────────

    /// @dev Transfer ownership of a UUPS proxy (OwnableUpgradeable) to newOwner.
    ///      Skips silently if the env var is not set, allowing partial deploys.
    function _transferUUPS(string memory envKey, address newOwner) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP  ", envKey, " (not set)"));
            skipped++;
            return;
        }
        OwnableUpgradeable(addr).transferOwnership(newOwner);
        console.log(string.concat("  OK    ", envKey, " -> timelock"));
        transferred++;
    }

    /// @dev Transfer ownership of a non-upgradeable Ownable contract.
    ///      Skips silently if the env var is not set.
    function _transferOwnable(string memory envKey, address newOwner) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP  ", envKey, " (not set)"));
            skipped++;
            return;
        }
        Ownable(addr).transferOwnership(newOwner);
        console.log(string.concat("  OK    ", envKey, " -> timelock"));
        transferred++;
    }

    /// @dev Transfer ownership of an UpgradeableBeacon to newOwner.
    ///      Skips silently if the env var is not set.
    function _transferBeacon(string memory envKey, address newOwner) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP  ", envKey, " (not set)"));
            skipped++;
            return;
        }
        UpgradeableBeacon(addr).transferOwnership(newOwner);
        console.log(string.concat("  OK    ", envKey, " -> timelock"));
        transferred++;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";

/**
 * @title DeployGovernance
 * @notice Deploys a platform-level TimelockController governed by a Gnosis Safe
 *         multisig, then transfers ownership of all deployed UUPS proxies and
 *         NFT beacons to the timelock.
 *
 * The governance chain:
 *   Safe multisig proposes → Timelock queues (48h delay) → Timelock executes
 *
 * Environment variables:
 *   PRIVATE_KEY             — Deployer / current owner key
 *   SAFE_ADDRESS            — Gnosis Safe multisig address
 *
 *   Core Ownable contracts (non-upgradeable):
 *     UNIVERSE_MANAGER
 *     LOAR_TOKEN_ADDRESS
 *     IDENTITY_NFT_ADDRESS
 *     FEE_LOCKER_ADDRESS
 *     SPLIT_ROUTER_ADDRESS
 *     REVENUE_MODULE_FACTORY
 *     SLOP_MARKET_ADDRESS
 *
 *   UUPS proxy addresses (all OwnableUpgradeable):
 *     PAYMENT_ROUTER_ADDRESS
 *     RIGHTS_REGISTRY_ADDRESS
 *     CANON_MARKETPLACE_ADDRESS
 *     CREDIT_MANAGER_ADDRESS
 *     AD_PLACEMENT_ADDRESS
 *     SUBSCRIPTION_MANAGER_ADDRESS
 *     LICENSING_REGISTRY_ADDRESS
 *     COLLAB_MANAGER_ADDRESS
 *     ANALYTICS_REGISTRY_ADDRESS
 *     LAUNCHPAD_STAKING_ADDRESS
 *     STORY_BOUNTIES_ADDRESS
 *
 *   NFT beacon addresses (UpgradeableBeacon / Ownable):
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
    uint256 constant MIN_DELAY = 48 hours; // 48-hour minimum delay

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address safe = vm.envAddress("SAFE_ADDRESS");

        console.log("=== LOAR Governance Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Safe multisig:", safe);
        console.log("Timelock delay:", MIN_DELAY, "seconds (48 hours)");

        vm.startBroadcast(pk);

        // ── Deploy TimelockController ───────────────────────────────
        // Proposers: only the Safe multisig
        // Executors: only the Safe multisig
        // Admin: address(0) — renounce admin immediately (no backdoor)
        address[] memory proposers = new address[](1);
        proposers[0] = safe;
        address[] memory executors = new address[](1);
        executors[0] = safe;

        TimelockController timelock = new TimelockController(
            MIN_DELAY,
            proposers,
            executors,
            address(0) // no admin — immutable roles
        );
        address timelockAddr = address(timelock);
        console.log("[1] TimelockController:", timelockAddr);

        // ── Transfer core Ownable contracts to timelock ─────────────
        console.log("\n--- Transferring core contract ownership ---");

        _transferOwnableIfSet("UNIVERSE_MANAGER", timelockAddr);
        _transferOwnableIfSet("LOAR_TOKEN_ADDRESS", timelockAddr);
        _transferOwnableIfSet("IDENTITY_NFT_ADDRESS", timelockAddr);
        _transferOwnableIfSet("FEE_LOCKER_ADDRESS", timelockAddr);
        _transferOwnableIfSet("SPLIT_ROUTER_ADDRESS", timelockAddr);
        _transferOwnableIfSet("REVENUE_MODULE_FACTORY", timelockAddr);
        _transferOwnableIfSet("SLOP_MARKET_ADDRESS", timelockAddr);

        // ── Transfer UUPS proxy ownership to timelock ───────────────
        console.log("\n--- Transferring UUPS proxy ownership ---");

        _transferIfSet("PAYMENT_ROUTER_ADDRESS", timelockAddr);
        _transferIfSet("RIGHTS_REGISTRY_ADDRESS", timelockAddr);
        _transferIfSet("CANON_MARKETPLACE_ADDRESS", timelockAddr);
        _transferIfSet("CREDIT_MANAGER_ADDRESS", timelockAddr);
        _transferIfSet("AD_PLACEMENT_ADDRESS", timelockAddr);
        _transferIfSet("SUBSCRIPTION_MANAGER_ADDRESS", timelockAddr);
        _transferIfSet("LICENSING_REGISTRY_ADDRESS", timelockAddr);
        _transferIfSet("COLLAB_MANAGER_ADDRESS", timelockAddr);
        _transferIfSet("ANALYTICS_REGISTRY_ADDRESS", timelockAddr);
        _transferIfSet("LAUNCHPAD_STAKING_ADDRESS", timelockAddr);
        _transferIfSet("STORY_BOUNTIES_ADDRESS", timelockAddr);
        _transferIfSet("ESCROW_ADDRESS", timelockAddr);

        // ── Transfer NFT beacon ownership to timelock ───────────────
        console.log("\n--- Transferring beacon ownership ---");

        _transferBeaconIfSet("EPISODE_EDITION_BEACON", timelockAddr);
        _transferBeaconIfSet("CHARACTER_NFT_BEACON", timelockAddr);
        _transferBeaconIfSet("ENTITY_NFT_BEACON", timelockAddr);
        _transferBeaconIfSet("ENTITY_EDITION_BEACON", timelockAddr);
        _transferBeaconIfSet("EPISODE_NFT_BEACON", timelockAddr);

        vm.stopBroadcast();

        // ── Summary ─────────────────────────────────────────────────
        console.log("\n========================================");
        console.log("  GOVERNANCE DEPLOYMENT COMPLETE");
        console.log("========================================");
        console.log("TimelockController:", timelockAddr);
        console.log("Safe (proposer + executor):", safe);
        console.log("Admin: renounced (address(0))");
        console.log("Min delay: 48 hours");
        console.log("");
        console.log("Add to .env:");
        console.log(string.concat("TIMELOCK_ADDRESS=", vm.toString(timelockAddr)));
        console.log("========================================");
    }

    /// @dev Transfer ownership of a UUPS proxy (OwnableUpgradeable) to the timelock.
    ///      Skips silently if the env var is not set.
    function _transferIfSet(string memory envKey, address newOwner) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP ", envKey, " (not set)"));
            return;
        }
        OwnableUpgradeable(addr).transferOwnership(newOwner);
        console.log(string.concat("  OK   ", envKey, " -> timelock"));
    }

    /// @dev Transfer ownership of an UpgradeableBeacon to the timelock.
    ///      Skips silently if the env var is not set.
    function _transferBeaconIfSet(string memory envKey, address newOwner) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP ", envKey, " (not set)"));
            return;
        }
        UpgradeableBeacon(addr).transferOwnership(newOwner);
        console.log(string.concat("  OK   ", envKey, " -> timelock"));
    }

    /// @dev Transfer ownership of a non-upgradeable Ownable contract to the timelock.
    ///      Skips silently if the env var is not set.
    function _transferOwnableIfSet(string memory envKey, address newOwner) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP ", envKey, " (not set)"));
            return;
        }
        Ownable(addr).transferOwnership(newOwner);
        console.log(string.concat("  OK   ", envKey, " -> timelock"));
    }
}

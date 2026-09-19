// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UniverseManager} from "../src/UniverseManager.sol";
import {UniverseFactory} from "../src/factories/UniverseFactory.sol";
import {LegacyContentBackupRegistry} from "../src/LegacyContentBackupRegistry.sol";

/**
 * @title DeployContentBackup
 * @notice Rolls out Phase 1 of the content-backup project onto an existing,
 *         already-deployed UniverseManager:
 *           1. Deploys a new UniverseFactory (built against the updated
 *              Universe.sol, which now has backupContent/batchBackupContent).
 *              UniverseFactory does `new Universe(config, address(this))`, so
 *              every universe minted after this factory is wired in gets the
 *              new function automatically, and reads its backupRelayer live
 *              from this factory. Universes minted before this stay on their
 *              old, frozen bytecode — that's expected, see
 *              LegacyContentBackupRegistry.
 *           2. Deploys LegacyContentBackupRegistry, pointed at the new
 *              factory (same relayer source as every new Universe, so
 *              there's one address to rotate, not two). NOT pointed at
 *              UniverseManager — it predates this feature and is itself
 *              non-upgradeable, so it can never gain a backupRelayer().
 *           3. Points UniverseManager.setUniverseFactory() at the new
 *              factory (so new universe creation actually uses it).
 *           4. Optionally sets UniverseFactory.setBackupRelayer() if
 *              BACKUP_RELAYER is provided — leave unset to configure it
 *              separately later (backupContent reverts for everyone until
 *              it's set, which is a safe default).
 *
 * @dev Before running, set:
 *      - PRIVATE_KEY: must be the existing UniverseManager's owner (this
 *        becomes the new UniverseFactory's owner too, since it's the deployer)
 *      - UNIVERSE_MANAGER: existing UniverseManager address (not redeployed)
 *      - BACKUP_RELAYER: optional, address to authorize for backupContent
 *
 * Run with: forge script script/DeployContentBackup.s.sol --rpc-url <url> --broadcast
 */
contract DeployContentBackupScript is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployerAddress = vm.addr(deployerPrivateKey);
        address universeManagerAddress = vm.envAddress("UNIVERSE_MANAGER");
        address backupRelayer = vm.envOr("BACKUP_RELAYER", address(0));

        require(universeManagerAddress != address(0), "UNIVERSE_MANAGER not set");

        UniverseManager manager = UniverseManager(payable(universeManagerAddress));

        console.log("=== Content Backup Deployment ===");
        console.log("Deployer:", deployerAddress);
        console.log("Existing UniverseManager:", universeManagerAddress);
        console.log("Current owner:", manager.owner());
        console.log("Current universeFactory:", manager.universeFactory());
        require(manager.owner() == deployerAddress, "Deployer is not the UniverseManager owner");

        vm.startBroadcast(deployerPrivateKey);

        console.log("\n1/4 Deploying new UniverseFactory...");
        UniverseFactory factory = new UniverseFactory(universeManagerAddress);
        console.log("   UniverseFactory deployed at:", address(factory));

        console.log("2/4 Deploying LegacyContentBackupRegistry...");
        LegacyContentBackupRegistry registry = new LegacyContentBackupRegistry(address(factory));
        console.log("   LegacyContentBackupRegistry deployed at:", address(registry));

        console.log("3/4 Pointing UniverseManager at the new factory...");
        manager.setUniverseFactory(address(factory));

        console.log("4/4 Backup relayer...");
        if (backupRelayer != address(0)) {
            console.log("    Setting backupRelayer:", backupRelayer);
            factory.setBackupRelayer(backupRelayer);
        } else {
            console.log(
                "    BACKUP_RELAYER not set - backupContent stays disabled until configured."
            );
        }

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("New UniverseFactory:", address(factory));
        console.log("LegacyContentBackupRegistry:", address(registry));
        console.log("UniverseManager.universeFactory():", manager.universeFactory());
        console.log("UniverseFactory.backupRelayer():", factory.backupRelayer());
    }
}

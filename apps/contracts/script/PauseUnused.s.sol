// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {LicensingRegistry} from "../src/revenue/LicensingRegistry.sol";
import {CollabManager} from "../src/revenue/CollabManager.sol";

/**
 * @title PauseUnused
 * @notice Pauses deployed contracts that have no public UI yet.
 *         Both contracts inherit PausableUpgradeable with an
 *         `onlyOwner` guard on `pause()`.
 *
 * Contracts paused:
 *   - LicensingRegistry — IP licensing marketplace (no UI)
 *   - CollabManager      — collaboration proposals (no UI)
 *
 * Environment variables:
 *   PRIVATE_KEY                  — Current owner key
 *   LICENSING_REGISTRY_ADDRESS   — LicensingRegistry proxy address
 *   COLLAB_MANAGER_ADDRESS       — CollabManager proxy address
 *
 * Run:
 *   forge script script/PauseUnused.s.sol \
 *     --rpc-url base --broadcast -vvv
 */
contract PauseUnusedScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address licAddr = vm.envAddress("LICENSING_REGISTRY_ADDRESS");
        address colAddr = vm.envAddress("COLLAB_MANAGER_ADDRESS");

        console.log("=== Pause Unused Contracts ===");
        console.log("Caller:", deployer);
        console.log("LicensingRegistry:", licAddr);
        console.log("CollabManager:", colAddr);

        vm.startBroadcast(pk);

        LicensingRegistry(licAddr).pause();
        console.log("[OK] LicensingRegistry paused");

        CollabManager(colAddr).pause();
        console.log("[OK] CollabManager paused");

        vm.stopBroadcast();

        console.log("\n========================================");
        console.log("  2 contracts paused successfully");
        console.log("========================================");
        console.log("To unpause, call unpause() from the owner");
    }
}

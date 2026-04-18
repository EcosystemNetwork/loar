// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {AdPlacement} from "../src/revenue/AdPlacement.sol";
import {LicensingRegistry} from "../src/revenue/LicensingRegistry.sol";
import {CollabManager} from "../src/revenue/CollabManager.sol";

/**
 * @title PauseUnused
 * @notice Pauses deployed contracts that have no public UI yet.
 *         All three contracts inherit PausableUpgradeable with an
 *         `onlyOwner` guard on `pause()`.
 *
 * Contracts paused:
 *   - AdPlacement       — programmatic ad bidding (no UI)
 *   - LicensingRegistry — IP licensing marketplace (no UI)
 *   - CollabManager      — collaboration proposals (no UI)
 *
 * Environment variables:
 *   PRIVATE_KEY                  — Current owner key
 *   AD_PLACEMENT_ADDRESS         — AdPlacement proxy address
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

        address adAddr = vm.envAddress("AD_PLACEMENT_ADDRESS");
        address licAddr = vm.envAddress("LICENSING_REGISTRY_ADDRESS");
        address colAddr = vm.envAddress("COLLAB_MANAGER_ADDRESS");

        console.log("=== Pause Unused Contracts ===");
        console.log("Caller:", deployer);
        console.log("AdPlacement:", adAddr);
        console.log("LicensingRegistry:", licAddr);
        console.log("CollabManager:", colAddr);

        vm.startBroadcast(pk);

        AdPlacement(adAddr).pause();
        console.log("[OK] AdPlacement paused");

        LicensingRegistry(licAddr).pause();
        console.log("[OK] LicensingRegistry paused");

        CollabManager(colAddr).pause();
        console.log("[OK] CollabManager paused");

        vm.stopBroadcast();

        console.log("\n========================================");
        console.log("  3 contracts paused successfully");
        console.log("========================================");
        console.log("To unpause, call unpause() from the owner");
    }
}

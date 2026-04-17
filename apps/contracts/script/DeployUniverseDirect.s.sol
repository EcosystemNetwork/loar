// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Universe} from "../src/Universe.sol";
import {IUniverseManager} from "../src/interfaces/IUniverseManager.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "../src/libraries/NodeOptions.sol";

/**
 * @title DeployUniverseDirect
 * @notice Deploys a standalone Universe contract directly (no UniverseManager).
 *         This gives us a Universe with swapNodes without the Manager size issue.
 *
 * Run:
 *   cd apps/contracts && source .env
 *   forge script script/DeployUniverseDirect.s.sol \
 *     --rpc-url sepolia --broadcast -vvv
 */
contract DeployUniverseDirectScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console.log("=== Deploy Universe Direct ===");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(pk);

        IUniverseManager.UniverseConfig memory config = IUniverseManager.UniverseConfig({
            nodeCreationOption: NodeCreationOptions.PUBLIC,
            nodeVisibilityOption: NodeVisibilityOptions.PUBLIC,
            universeAdmin: deployer,
            name: "LOAR Testnet Universe",
            imageURL: "https://loar.fun/logo.png",
            description: "Test universe with interchangeable video nodes (swapNodes)",
            universeManager: deployer  // deployer acts as manager for standalone deploy
        });

        Universe universe = new Universe(config);
        console.log("Universe deployed at:", address(universe));

        vm.stopBroadcast();

        console.log("\n=== Update addresses-test.ts ===");
        console.log("TIMELINE_ADDRESS=", address(universe));
    }
}

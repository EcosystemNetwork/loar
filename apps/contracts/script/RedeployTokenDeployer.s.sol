// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UniverseTokenDeployer} from "../src/UniverseTokenDeployer.sol";
import {UniverseManager} from "../src/UniverseManager.sol";

/// @notice Deploys a new UniverseTokenDeployer pointing to the new UniverseManager,
///         then wires it into the manager.
contract RedeployTokenDeployerScript is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address um = vm.envAddress("UNIVERSE_MANAGER");

        console.log("UniverseManager:", um);

        vm.startBroadcast(pk);

        UniverseTokenDeployer td = new UniverseTokenDeployer(um);
        console.log("New TokenDeployer:", address(td));

        UniverseManager(payable(um)).setTokenDeployer(address(td));
        console.log("Wired into UniverseManager");

        vm.stopBroadcast();
    }
}

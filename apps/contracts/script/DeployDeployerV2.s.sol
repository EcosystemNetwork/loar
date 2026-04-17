// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {UniverseTokenDeployerV2} from "../src/UniverseTokenDeployerV2.sol";

interface IUniverseManagerAdmin {
    function setTokenDeployer(address _tokenDeployer) external;
    function tokenDeployer() external view returns (address);
    function owner() external view returns (address);
}

contract DeployDeployerV2 is Script {
    function run() external {
        address universeManager;
        address vestingContract;

        if (block.chainid == 11155111) {
            universeManager = 0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce;
            vestingContract = 0x5d74D9e42a52D04DEC9F895F2c9D2e14b1DdCD64;
        } else if (block.chainid == 84532) {
            universeManager = 0x46ce7cd72763B784977349686AEA72B84d3F86B6;
            vestingContract = 0x36E25222f7E5C6f4dC8f918B68C61da83330C97F;
        } else {
            revert("Unsupported chain");
        }

        vm.startBroadcast();

        // Deploy new token deployer with vesting support
        // NOTE: bondingCurveFactory must be set after deployment via setBondingCurveFactory()
        UniverseTokenDeployerV2 deployerV2 = new UniverseTokenDeployerV2(
            universeManager,
            vestingContract,
            address(0)  // bondingCurveFactory — set post-deploy
        );
        console.log("UniverseTokenDeployerV2 deployed at:", address(deployerV2));

        // Swap the deployer on UniverseManager
        address currentDeployer = IUniverseManagerAdmin(universeManager).tokenDeployer();
        console.log("Current deployer:", currentDeployer);

        IUniverseManagerAdmin(universeManager).setTokenDeployer(address(deployerV2));
        console.log("TokenDeployer updated to V2 with vesting!");

        vm.stopBroadcast();
    }
}

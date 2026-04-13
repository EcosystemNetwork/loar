// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";

/**
 * @title DeployTimelock
 * @notice Deploys a TimelockController for use with UniverseTimelockGovernor.
 *
 * The timelock sits between the governor and on-chain execution:
 *   Governor passes proposal → Timelock queues with 24h delay → Timelock executes
 *
 * This gives the community a window to exit if a hostile proposal passes.
 *
 * Run:
 *   forge script script/DeployTimelock.s.sol --rpc-url sepolia --broadcast --verify
 *
 * After deployment:
 *   1. Deploy UniverseTimelockGovernor with this timelock address
 *   2. Grant the governor the PROPOSER_ROLE on the timelock
 *   3. Grant the timelock the EXECUTOR_ROLE (open to anyone, or restricted)
 */
contract DeployTimelockScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // 24-hour minimum delay
        uint256 minDelay = vm.envOr("TIMELOCK_DELAY", uint256(24 hours));

        console.log("Deployer:", deployer);
        console.log("Min delay:", minDelay, "seconds");

        vm.startBroadcast(pk);

        // Proposers: initially the deployer (will be replaced by governor)
        // Executors: open (address(0) means anyone can execute after delay)
        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone can execute

        TimelockController timelock = new TimelockController(
            minDelay,
            proposers,
            executors,
            deployer  // admin — should renounce after governor is set up
        );

        console.log("TimelockController:", address(timelock));

        vm.stopBroadcast();

        console.log("\n=== Next Steps ===");
        console.log("1. Deploy UniverseTimelockGovernor with this timelock");
        console.log("2. Grant governor PROPOSER_ROLE on timelock");
        console.log("3. Renounce admin role from deployer");
    }
}

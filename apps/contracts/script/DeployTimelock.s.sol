// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";

/**
 * @title DeployTimelock
 * @notice Deploys a platform-level TimelockController for LOAR governance.
 *
 * Governance chain:
 *   Gnosis Safe multisig (proposer + executor) -> TimelockController (48h delay) -> contract ownership
 *
 * Environment variables:
 *   PRIVATE_KEY     - Deployer wallet private key
 *   SAFE_ADDRESS    - Gnosis Safe multisig address (proposer + executor)
 *
 * Optional:
 *   TIMELOCK_DELAY  - Override minimum delay in seconds (default: 172800 = 48 hours)
 *
 * Run:
 *   forge script script/DeployTimelock.s.sol --rpc-url base --broadcast --verify -vvv
 *
 * After deployment:
 *   1. Copy TIMELOCK_ADDRESS into .env
 *   2. Run TransferToMultisig.s.sol to transfer all contract ownership to the timelock
 */
contract DeployTimelockScript is Script {
    uint256 constant DEFAULT_MIN_DELAY = 48 hours; // 172800 seconds

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address safe = vm.envAddress("SAFE_ADDRESS");
        uint256 minDelay = vm.envOr("TIMELOCK_DELAY", DEFAULT_MIN_DELAY);

        require(safe != address(0), "SAFE_ADDRESS must not be zero");

        console.log("=== Deploy Platform TimelockController ===");
        console.log("Deployer:", deployer);
        console.log("Safe multisig:", safe);
        console.log("Min delay:", minDelay, "seconds");
        console.log("");

        vm.startBroadcast(pk);

        // Proposers: only the Safe multisig can propose timelocked operations
        // Executors: only the Safe multisig can execute after delay
        // Admin: address(0) - no separate admin, roles are immutable
        address[] memory proposers = new address[](1);
        proposers[0] = safe;
        address[] memory executors = new address[](1);
        executors[0] = safe;

        TimelockController timelock = new TimelockController(
            minDelay,
            proposers,
            executors,
            address(0) // no admin - immutable roles, no backdoor
        );

        console.log("[OK] TimelockController:", address(timelock));

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("  TIMELOCK DEPLOYMENT COMPLETE");
        console.log("========================================");
        console.log("");
        console.log("Add to .env:");
        console.log(string.concat("TIMELOCK_ADDRESS=", vm.toString(address(timelock))));
        console.log("");
        console.log("Next steps:");
        console.log("  1. Copy TIMELOCK_ADDRESS into .env");
        console.log("  2. Run TransferToMultisig.s.sol to transfer contract ownership");
        console.log("  3. Verify on BaseScan that roles are correct:");
        console.log("     - PROPOSER_ROLE: Safe address only");
        console.log("     - EXECUTOR_ROLE: Safe address only");
        console.log("     - DEFAULT_ADMIN_ROLE: nobody (renounced)");
        console.log("========================================");
    }
}

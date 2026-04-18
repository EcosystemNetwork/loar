// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {DeployAllScript} from "./DeployAll.s.sol";

/**
 * @title DeployBase
 * @notice Deploys the full LOAR protocol to Base mainnet (chain 8453).
 *         Wraps DeployAll with Base-specific configuration and verification.
 *
 * Prerequisites:
 *   1. Set RPC_8453 in .env (Base mainnet RPC URL)
 *   2. Set VERIFICATION_KEY_8453 for BaseScan verification
 *   3. Set WETH to Base mainnet WETH: 0x4200000000000000000000000000000000000006
 *   4. Set PRIVATE_KEY for deployer wallet (or use --ledger for hardware wallet)
 *   5. Ensure deployer has sufficient ETH on Base for gas
 *
 * Run:
 *   forge script script/DeployBase.s.sol \
 *     --rpc-url base --broadcast --verify \
 *     --etherscan-api-key $VERIFICATION_KEY_8453 \
 *     -vvv
 *
 * Post-deployment:
 *   1. Copy printed addresses into .env
 *   2. Run DeployGovernance.s.sol to transfer ownership to Safe + Timelock
 *   3. Verify all contracts on BaseScan
 *   4. Update frontend contract addresses (VITE_ prefixed vars)
 */
contract DeployBaseScript is Script {
    /// @notice Base mainnet WETH address (predeploy)
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    function run() public {
        // Validate we're on Base mainnet
        require(block.chainid == 8453, "This script must be run on Base mainnet (chain 8453)");

        console.log("=== LOAR Base Mainnet Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("WETH:", BASE_WETH);
        console.log("");
        console.log("IMPORTANT: After deployment, run DeployGovernance.s.sol");
        console.log("to transfer all contract ownership to the Safe + Timelock.");
        console.log("");

        // Set WETH env var for DeployAll to use
        vm.setEnv("WETH", vm.toString(BASE_WETH));

        // Run the full deployment
        DeployAllScript deployAll = new DeployAllScript();
        deployAll.run();

        console.log("");
        console.log("========================================");
        console.log("  BASE MAINNET DEPLOYMENT COMPLETE");
        console.log("========================================");
        console.log("");
        console.log("Next steps:");
        console.log("  1. Copy addresses above into .env");
        console.log("  2. Set SAFE_ADDRESS in .env (your Gnosis Safe)");
        console.log("  3. Run: forge script script/DeployGovernance.s.sol --rpc-url base --broadcast --verify");
        console.log("  4. Update VITE_ frontend addresses");
        console.log("  5. Set VITE_CHAIN_ENV=mainnet");
        console.log("========================================");
    }
}

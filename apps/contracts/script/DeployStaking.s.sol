// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {LaunchpadStaking} from "../src/revenue/LaunchpadStaking.sol";

/**
 * @title DeployStaking
 * @notice Deploys the LaunchpadStaking contract as a UUPS proxy.
 *
 * Prerequisites:
 *   - $LOAR token deployed (LOAR_TOKEN env)
 *   - Treasury address set (TREASURY env, defaults to deployer)
 *
 * Run:
 *   forge script script/DeployStaking.s.sol \
 *     --rpc-url sepolia --broadcast --verify
 *
 * After deployment, add to .env:
 *   LAUNCHPAD_STAKING_ADDRESS=<proxy address>
 */
contract DeployStakingScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address loarToken = vm.envOr("LOAR_TOKEN", address(0));
        address treasury = vm.envOr("TREASURY", deployer);
        address liquidityPool = vm.envOr("LIQUIDITY_POOL", treasury);

        require(loarToken != address(0), "LOAR_TOKEN env required");

        console.log("Deployer:", deployer);
        console.log("LoarToken:", loarToken);
        console.log("Treasury:", treasury);
        console.log("LiquidityPool:", liquidityPool);

        vm.startBroadcast(pk);

        // Deploy implementation
        LaunchpadStaking impl = new LaunchpadStaking();
        console.log("LaunchpadStaking impl:", address(impl));

        // Deploy proxy with initialize call
        LaunchpadStaking staking = LaunchpadStaking(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(LaunchpadStaking.initialize, (loarToken, treasury, liquidityPool))
                )
            )
        );
        console.log("LaunchpadStaking proxy:", address(staking));

        // Configure default tiers (matching server-side TIER_THRESHOLDS)
        // Tier enum: 0=NONE, 1=BRONZE, 2=SILVER, 3=GOLD, 4=DIAMOND
        //                              tier  minStake       weight feeDisc curationBoost priorityQueue
        staking.setTierConfig(LaunchpadStaking.Tier(1), 1_000e18,    100,   100,   100,   false); // BRONZE
        staking.setTierConfig(LaunchpadStaking.Tier(2), 10_000e18,   200,   250,   150,   true);  // SILVER
        staking.setTierConfig(LaunchpadStaking.Tier(3), 100_000e18,  400,   500,   200,   true);  // GOLD
        staking.setTierConfig(LaunchpadStaking.Tier(4), 500_000e18,  800,   1000,  300,   true);  // DIAMOND
        console.log("Tier configs set");

        vm.stopBroadcast();

        console.log("\n=== Add to .env ===");
        console.log("LAUNCHPAD_STAKING_ADDRESS=", address(staking));
    }
}

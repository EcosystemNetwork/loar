// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {SplitRouter} from "../src/SplitRouter.sol";

/**
 * @title DeploySplitRouter
 * @notice Deploys the SplitRouter contract (non-upgradeable).
 *
 * Prerequisites:
 *   - PaymentRouter deployed (PAYMENT_ROUTER env)
 *
 * Run:
 *   forge script script/DeploySplitRouter.s.sol \
 *     --rpc-url sepolia --broadcast --verify
 *
 * After deployment, add to .env:
 *   SPLIT_ROUTER_ADDRESS=<deployed address>
 */
contract DeploySplitRouterScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address paymentRouter = vm.envAddress("PAYMENT_ROUTER");

        require(paymentRouter != address(0), "PAYMENT_ROUTER env required");

        console.log("Deployer:", deployer);
        console.log("PaymentRouter:", paymentRouter);

        vm.startBroadcast(pk);

        SplitRouter splitRouter = new SplitRouter(paymentRouter);
        console.log("SplitRouter:", address(splitRouter));

        vm.stopBroadcast();

        console.log("\n=== Add to .env ===");
        console.log("SPLIT_ROUTER_ADDRESS=", address(splitRouter));
    }
}
